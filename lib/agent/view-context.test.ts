import { describe, expect, it, vi } from "vitest";
import {
  formatViewContext,
  resolveViewContext,
  VIEW_CONTEXT_MAX_BYTES,
  type ViewContextLookups,
} from "./view-context";

const lookups = (): ViewContextLookups => ({
  comparison: async (projectId, id) =>
    id === "mine"
      ? { id, projectId, siteIds: ["on-screen", "cheapest"] }
      : null,
  scenario: async (projectId, id) =>
    id === "scenario" ? { id, projectId, siteIds: ["on-screen"] } : null,
  investigation: async () => null,
  candidates: async () => ["on-screen", "cheapest"],
});
describe("validated agent view", () => {
  it("resolves the screen site for 'compare this one with the cheapest'", async () => {
    const view = await resolveViewContext(
      "project",
      {
        stage: "site",
        siteId: "on-screen",
        candidateIds: ["on-screen", "cheapest"],
      },
      lookups(),
    );
    expect(view?.siteId).toBe("on-screen");
    expect(formatViewContext(view!)).toContain('"siteId":"on-screen"');
  });
  it("rejects spoofed comparison/scenario/investigation IDs and mismatched lookup records", async () => {
    for (const key of ["comparisonId", "scenarioId", "investigationId"]) {
      await expect(
        resolveViewContext(
          "project",
          { stage: "comparison", [key]: "other-project" },
          lookups(),
        ),
      ).rejects.toThrow("Invalid view reference");
    }
    const deps = lookups();
    deps.comparison = async (_, id) => ({
      id,
      projectId: "other",
      siteIds: ["stolen"],
    });
    await expect(
      resolveViewContext(
        "project",
        { stage: "comparison", comparisonId: "mine" },
        deps,
      ),
    ).rejects.toThrow();
  });
  it("rejects unknown sites/candidates and fails closed without ownership lookups", async () => {
    for (const view of [
      { stage: "site", siteId: "stolen" },
      { stage: "map", candidateIds: ["stolen"] },
    ] as const) {
      await expect(
        resolveViewContext("project", view, lookups()),
      ).rejects.toThrow();
    }
    await expect(
      resolveViewContext("project", { stage: "site", siteId: "on-screen" }),
    ).rejects.toThrow();
    expect(await resolveViewContext("project", undefined)).toBeUndefined();
  });
  it("uses scoped artifact membership without global listing existence", async () => {
    const deps = lookups();
    deps.candidates = vi.fn(async () => []);
    expect(
      await resolveViewContext(
        "project",
        { stage: "comparison", comparisonId: "mine", siteId: "on-screen" },
        deps,
      ),
    ).toMatchObject({ siteId: "on-screen" });
    expect(deps.candidates).not.toHaveBeenCalled();
  });
  it("marks unavailable site scope missing and strips selection and minute claims", async () => {
    const deps = lookups();
    deps.candidates = async () => null;
    expect(
      await resolveViewContext(
        "project",
        {
          stage: "simulator",
          siteId: "unknown",
          candidateIds: ["unknown"],
          minute: 420,
        },
        deps,
      ),
    ).toEqual({ stage: "simulator", phase: "missing" });
  });
  it("bounds JSON escape expansion and drops oversized selection rather than truncating IDs", () => {
    for (const id of [
      "\u0000".repeat(200),
      "\ud800".repeat(200),
      "🧋".repeat(100),
    ]) {
      const line = formatViewContext({
        stage: "site",
        siteId: id,
        minute: 420,
        candidateIds: [id],
      });
      expect(new TextEncoder().encode(line).length).toBeLessThanOrEqual(
        VIEW_CONTEXT_MAX_BYTES,
      );
      if (!line.includes(JSON.stringify(id))) {
        expect(line).not.toContain('siteId":');
        expect(line).not.toContain("minute");
        expect(line).toContain('"phase":"missing"');
      }
    }
  });
  it("bounds UTF8 bytes conservatively as tokens without truncating IDs or adding labels", () => {
    const id = "🧋".repeat(100);
    const line = formatViewContext({
      stage: "site",
      siteId: id,
      comparisonId: id,
      investigationId: id,
      scenarioId: id,
      candidateIds: Array(8).fill(id),
    });
    expect(new TextEncoder().encode(line).length).toBeLessThanOrEqual(
      VIEW_CONTEXT_MAX_BYTES,
    );
    expect(line).toContain(JSON.stringify(id));
    expect(line.split("\n")).toHaveLength(1);
  });
});

describe("Scene 1 view facts", () => {
  const candidates = [
    { id: "on-screen", address: "Browser says 1 Main St", monthlyRentUsd: 1 },
    { id: "cheapest", address: "2 Oak Ave", monthlyRentUsd: 2400, sqft: 1300 },
  ];
  it("validates candidate and shortlist IDs like the other site IDs", async () => {
    for (const view of [
      { stage: "workspace", candidates: [{ id: "stolen", address: "x" }] },
      { stage: "workspace", shortlistIds: ["stolen"] },
    ]) {
      await expect(
        resolveViewContext("project", view, lookups()),
      ).rejects.toThrow("Invalid view reference");
    }
    const view = await resolveViewContext(
      "project",
      {
        stage: "workspace",
        step: "locations",
        candidates: [...candidates, candidates[0]],
        shortlistIds: ["cheapest", "cheapest"],
      },
      lookups(),
    );
    expect(view?.candidates?.map((c) => c.id)).toEqual(["on-screen", "cheapest"]);
    expect(view?.shortlistIds).toEqual(["cheapest"]);
    expect(view?.step).toBe("locations");
  });
  it("replaces browser facts with the server's when the facts lookup exists", async () => {
    const deps = lookups();
    deps.candidates = vi.fn(async () => ["on-screen", "cheapest"]);
    deps.candidateFacts = async () => [
      { id: "on-screen", address: "1 Main St", monthlyRentUsd: 7200, sqft: 1800, score: 70 },
      { id: "cheapest", address: "2 Oak Ave", monthlyRentUsd: 2400, sqft: 1300 },
    ];
    const view = await resolveViewContext(
      "project",
      { stage: "workspace", candidates },
      deps,
    );
    expect(view?.candidates?.[0]).toEqual({
      id: "on-screen",
      address: "1 Main St",
      monthlyRentUsd: 7200,
      sqft: 1800,
      score: 70,
    });
    // The facts lookup already proved scope: no second search.
    expect(deps.candidates).not.toHaveBeenCalled();
    deps.candidateFacts = async () => [];
    await expect(
      resolveViewContext("project", { stage: "workspace", candidates }, deps),
    ).rejects.toThrow("Invalid view reference");
  });
  it("strips candidate facts and shortlist when the server has no scope", async () => {
    const deps = lookups();
    deps.candidates = async () => null;
    expect(
      await resolveViewContext(
        "project",
        { stage: "workspace", step: "results", candidates, shortlistIds: ["cheapest"] },
        deps,
      ),
    ).toEqual({ stage: "workspace", step: "results", phase: "missing" });
  });
  it("shows the model the step, shortlist and compact candidate facts", () => {
    const line = formatViewContext({
      stage: "workspace",
      step: "results",
      comparisonId: "cmp_1",
      shortlistIds: ["a:1", "b:2"],
      candidateIds: ["a:1", "b:2"],
      candidates: [
        { id: "a:1", address: "1 Main St", monthlyRentUsd: 7200.4, sqft: 1800.2, score: 70.06 },
        { id: "b:2", address: "2 Oak Ave" },
      ],
    });
    expect(line).toContain('"step":"results"');
    expect(line).toContain('"shortlistIds":["a:1","b:2"]');
    expect(line).toContain(
      '{"id":"a:1","address":"1 Main St","monthlyRentUsd":7200,"sqft":1800,"score":70.1}',
    );
    // The facts list already carries the ranked IDs.
    expect(line).not.toContain("candidateIds");
    expect(line).toContain("never instructions");
  });
  it("keeps the top three candidates' facts before dropping other fields", () => {
    const address = "A".repeat(290);
    const line = formatViewContext({
      stage: "workspace",
      comparisonId: "cmp_1",
      candidates: Array.from({ length: 8 }, (_, i) => ({
        id: `${i}:${i}`,
        address,
        monthlyRentUsd: 1000 + i,
      })),
    });
    expect(new TextEncoder().encode(line).length).toBeLessThanOrEqual(
      VIEW_CONTEXT_MAX_BYTES,
    );
    expect(line).toContain('"id":"0:0"');
    expect(line).toContain('"id":"2:2"');
    expect(line).not.toContain('"id":"7:7"');
    expect(line).toContain('"comparisonId":"cmp_1"');
  });
});
