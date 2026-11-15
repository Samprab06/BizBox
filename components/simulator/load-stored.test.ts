import { describe, expect, it, vi } from "vitest";
import { fixture } from "@/lib/agent/__fixtures__/plan";
import { loadStoredSimulator, type SimulatorLoadIssue } from "./load-stored";

const dependencies = () => ({
  createStore: () => ({
    load: async () => fixture().comparison,
    currentProfileVersion: async () => 1,
  }),
  diagnose: vi.fn<(issue: SimulatorLoadIssue) => void>(),
});
describe("simulator comparison load states", () => {
  it("chooses example only when no comparison parameter was supplied, without a database read", async () => {
    const createStore = () => {
      throw new Error("No read should be needed");
    };
    expect(
      await loadStoredSimulator({ projectId: "p1" }, { createStore }),
    ).toEqual({ kind: "example" });
  });
  it("does not treat explicit empty, repeated or oversized comparison parameters as an example", async () => {
    const createStore = () => {
      throw new Error("Invalid input must not cause a read");
    };
    for (const comparison of ["", " ", ["one", "two"], "x".repeat(301)]) {
      expect(
        await loadStoredSimulator(
          { projectId: "p1", comparison },
          { createStore },
        ),
      ).toEqual({ kind: "not_found" });
    }
  });
  it("retains the chosen stored site's seeded data", async () => {
    const deps = dependencies();
    const record = fixture().comparison;
    const siteId = record.evaluation.result.ranking[1];
    const result = await loadStoredSimulator(
      { projectId: "p1", comparison: record.id, siteId },
      deps,
    );
    expect(result.kind).toBe("stored");
    if (result.kind !== "stored") throw new Error("Expected stored replay");
    expect(result.value.data[0].run.siteId).toBe(siteId);
    expect(result.value.data[0].run.seed).toBe(
      record.runs.find((run) => run.siteId === siteId)?.seed,
    );
    expect(result.value.story.scenarioLabels).toEqual(["Weekday", "Weekend"]);
    expect(result.value.synthetic).toBe(true);
  });
  it("returns not_found only for a missing record", async () => {
    const result = await loadStoredSimulator(
      { projectId: "p1", comparison: "does-not-exist" },
      {
        createStore: () => ({
          load: async () => null,
          currentProfileVersion: async () => 1,
        }),
      },
    );
    expect(result).toEqual({ kind: "not_found" });
  });
  it("returns error for unreadable storage and logs only a fixed diagnostic category", async () => {
    const diagnose = vi.fn<(issue: SimulatorLoadIssue) => void>();
    const result = await loadStoredSimulator(
      { projectId: "p1", comparison: "private-id" },
      {
        createStore: () => {
          throw new Error(
            "postgres://user:password@host/database private payload",
          );
        },
        diagnose,
      },
    );
    expect(result).toEqual({ kind: "error" });
    expect(diagnose.mock.calls).toEqual([["read"]]);
    expect(JSON.stringify(diagnose.mock.calls)).not.toContain("password");
  });
  it("returns error for malformed/incomplete stored data rather than substituting an example", async () => {
    const diagnose = vi.fn<(issue: SimulatorLoadIssue) => void>();
    const record = fixture().comparison;
    record.runs = [];
    const result = await loadStoredSimulator(
      { projectId: "p1", comparison: record.id },
      {
        createStore: () => ({
          load: async () => record,
          currentProfileVersion: async () => 1,
        }),
        diagnose,
      },
    );
    expect(result).toEqual({ kind: "error" });
    expect(diagnose.mock.calls).toEqual([["stored_data"]]);
  });
  it("keeps a valid replay when the profile freshness read fails", async () => {
    const diagnose = vi.fn<(issue: SimulatorLoadIssue) => void>();
    const record = fixture().comparison;
    const result = await loadStoredSimulator(
      { projectId: "p1", comparison: record.id },
      {
        createStore: () => ({
          load: async () => record,
          currentProfileVersion: async () => {
            throw new Error("private freshness data");
          },
        }),
        diagnose,
      },
    );
    expect(result.kind).toBe("stored");
    if (result.kind === "stored")
      expect(result.value).toMatchObject({
        profileVersionUnknown: true,
        outdated: false,
      });
    expect(diagnose.mock.calls).toEqual([["freshness"]]);
  });
});

it("classifies invalid stored payloads as error and keeps diagnostics bounded and credential-free", async () => {
  const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
  try {
    const record = fixture().comparison;
    record.evaluation.request = null as never;
    expect(
      await loadStoredSimulator(
        { projectId: "p1", comparison: record.id },
        {
          createStore: () => ({
            load: async () => record,
            currentProfileVersion: async () => 1,
          }),
        },
      ),
    ).toEqual({ kind: "error" });
    expect(
      await loadStoredSimulator(
        { projectId: "private-project", comparison: "private-record" },
        {
          createStore: () => {
            throw new Error(
              "postgres://user:password@host/db " + "sensitive".repeat(1000),
            );
          },
        },
      ),
    ).toEqual({ kind: "error" });
    for (const [entry] of warn.mock.calls) {
      expect(String(entry).length).toBeLessThan(100);
      expect(JSON.parse(String(entry))).toMatchObject({
        event: "simulator_load_issue",
      });
      expect(String(entry)).not.toMatch(/password|private|postgres|sensitive/);
    }
  } finally {
    warn.mockRestore();
  }
});
