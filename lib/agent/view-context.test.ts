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
