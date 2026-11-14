import { describe, expect, it } from "vitest";
import { getPreviewProject } from "@/lib/workspace-preview";
import {
  conceptFromSession,
  planContextSource,
  resolveWorkspaceContext,
  reportsForRoute,
  type WorkspaceObservation,
} from "./workspace-context";

const project = getPreviewProject("houston-coffee")!;
const listing = {
  id: "201:301",
  name: "Suite 301",
  address: "101 Invented St",
  synthetic: false,
};
const search: WorkspaceObservation = {
  kind: "search",
  phase: "live",
  candidates: [listing],
  evidenceId: "ev1",
};
const comparison: WorkspaceObservation = {
  kind: "comparison",
  phase: "ready",
  comparisonId: "cmp1",
  synthetic: false,
  siteIds: [listing.id],
  candidates: [listing],
};
const context = (
  path: string,
  query = "",
  observations: WorkspaceObservation[] = [],
) =>
  resolveWorkspaceContext({
    project,
    pathname: `/projects/${project.id}/${path}`,
    search: query,
    concept: "Neighborhood café",
    observations,
  });

describe("workspace context", () => {
  it("reads an incomplete saved concept without borrowing fixture facts", () => {
    expect(
      conceptFromSession(
        JSON.stringify({
          profile: { concept: { value: " My café ", origin: "founder" } },
          messages: [],
        }),
      ),
    ).toBe("My café");
    expect(conceptFromSession("not json")).toBeNull();
    expect(conceptFromSession(null)).toBeNull();
  });
  it("keeps founder intake independent of preview fixtures when no location is selected", () => {
    const result = context("intake");
    expect(result.example).toBe(false);
    expect(result.location.text).toBe("Choose a location");
    expect(result.status.text).toBe("Your input");
    expect(result.concept.text).toBe("Neighborhood café");
    const incomplete = resolveWorkspaceContext({
      project,
      pathname: `/projects/${project.id}/intake`,
      search: "",
      concept: null,
      observations: [],
    });
    expect(incomplete.example).toBe(false);
    expect(incomplete.concept.text).toBe("Describe your business");
  });
  it("marks fixture details Example even with an unrelated live search", () => {
    const result = context("sites/montrose", "", [search]);
    expect(result.example).toBe(true);
    expect(result.location.text).toBe("Montrose storefront");
    expect(result.status.text).toBe("Example data");
    expect(result.status.href).toContain("#listing-source");
  });
  it("shows live suite/address and nearby evidence without an Example badge", () => {
    const result = context("map", "site=201%3A301", [search]);
    expect(result.example).toBe(false);
    expect(result.location.text).toContain("Suite 301");
    expect(result.location.text).toContain("101 Invented St");
    expect(result.status.text).toBe("Live listings");
    expect(result.status.href).toContain("#evidence-ev1");
  });
  it("recognizes synthetic API listings as examples", () => {
    const result = context("map", "site=201:301", [
      { ...search, candidates: [{ ...listing, synthetic: true }] },
    ]);
    expect(result.example).toBe(true);
    expect(result.status.text).toBe("Example data");
  });
  it("does not select the first live listing on an unselected map", () => {
    expect(context("map", "", [search]).location.text).toBe(
      "Choose a location",
    );
  });
  it("does not replace an unverified live detail with a fixture location", () => {
    const result = context("sites/201%3A301", "", [
      { kind: "search", phase: "example", candidates: [] },
    ]);
    expect(result.location.text).toBe("Site 201:301 · address unavailable");
    expect(result.example).toBe(false);
    expect(result.status.text).toBe("Listing unavailable");
  });
  it("clears fixture identity while a fresh route is loading", () => {
    const result = context("map", "site=201:301", [
      { kind: "search", phase: "loading", candidates: [] },
    ]);
    expect(result.example).toBe(false);
    expect(result.status.text).toBe("Loading context…");
  });
  it("uses current comparison data rather than a stale fixture query selection", () => {
    const result = context("comparison", "site=montrose", [search, comparison]);
    expect(result.example).toBe(false);
    expect(result.location.text).toContain("101 Invented St");
    expect(result.status.text).toBe("Live comparison");
    expect(result.qualifier).toBe("Modeled, not a forecast");
    expect(result.scenario.text).toBe("Baseline");
    expect(result.scenario.href).toContain("comparison=cmp1");
  });
  it("keeps synthetic stored comparisons Example and unknown metadata unverified", () => {
    expect(
      context("comparison", "", [{ ...comparison, synthetic: true }]).example,
    ).toBe(true);
    const unknown = context("comparison", "", [
      { ...comparison, synthetic: undefined },
    ]);
    expect(unknown.example).toBe(false);
    expect(unknown.status.text).toBe("Comparison provenance unavailable");
  });
  it("ignores a prior comparison payload while another permalink loads", () => {
    const result = context("comparison", "comparison=cmp2", [comparison]);
    expect(result.example).toBe(false);
    expect(result.status.text).toBe("Loading context…");
    expect(result.location.text).toBe("Choose a location");
  });
  it("clearly marks the displayed comparison fallback after a failed retry", () => {
    const result = context("comparison", "site=201:301", [
      { ...comparison, phase: "example" },
    ]);
    expect(result.example).toBe(true);
    expect(result.location.text).toBe("Montrose storefront");
  });
  it("describes stored replay location without inventing an address", () => {
    const result = context("replay", "comparison=cmp1&site=201:301", [
      { ...comparison, kind: "stored", candidates: [] },
      { kind: "replay", phase: "ready", siteId: listing.id, synthetic: false },
    ]);
    expect(result.example).toBe(false);
    expect(result.location.text).toBe("Site 201:301 · address unavailable");
    expect(result.status.text).toBe("Stored simulation");
  });
  it("labels a replay fallback Example even when its parent comparison is live", () => {
    const result = context("replay", "comparison=cmp1&site=201:301", [
      { ...comparison, kind: "stored" },
      { kind: "replay", phase: "example", siteId: listing.id },
    ]);
    expect(result.example).toBe(true);
    expect(result.status.text).toBe("Example data");
    expect(result.location.text).toBe("Montrose storefront");
  });
  it("does not retain a previous site's replay badge while the new run loads", () => {
    const result = context("replay", "comparison=cmp1&site=202:302", [
      { ...comparison, kind: "stored" },
      { kind: "replay", phase: "example", siteId: listing.id },
    ]);
    expect(result.example).toBe(false);
    expect(result.status.text).toBe("Loading context…");
  });
  it("labels synthetic candidate data Example before any comparison has run", () => {
    const result = context("comparison", "", [
      {
        ...comparison,
        comparisonId: undefined,
        siteIds: [],
        candidates: [{ ...listing, synthetic: true }],
      },
    ]);
    expect(result.example).toBe(true);
    expect(result.status.text).toBe("Example data");
  });
  it("does not claim a live comparison before a run exists", () => {
    const result = context("comparison", "", [
      {
        ...comparison,
        comparisonId: undefined,
        synthetic: undefined,
        siteIds: [],
      },
    ]);
    expect(result.status.text).toBe("Ready to compare");
  });
  it("resolves plan source, missing, failed and outdated states without guessing live data", () => {
    const plan = {
      kind: "plan",
      phase: "ready",
      comparisonId: "cmp1",
      synthetic: true,
      siteIds: [listing.id],
    } as const;
    expect(
      context("plan", "comparison=cmp1", [
        { ...plan, siteIds: [...plan.siteIds] },
      ]).example,
    ).toBe(true);
    const live = context("plan", "comparison=cmp1", [
      { ...plan, synthetic: false, siteIds: [...plan.siteIds] },
    ]);
    expect(live.status.text).toBe("Stored plan");
    expect(live.qualifier).toBe("Modeled, not a forecast");
    expect(
      context("plan", "comparison=cmp1", [
        { ...plan, phase: "outdated", synthetic: false, siteIds: [] },
      ]).status.text,
    ).toBe("Outdated comparison");
    expect(
      context("plan", "comparison=cmp1", [
        { ...plan, phase: "error", siteIds: [] },
      ]).status.text,
    ).toBe("Plan unavailable");
    expect(context("plan", "", []).status.text).toBe("Choose a comparison");
    expect(
      context("plan", "comparison=other", [{ ...plan, siteIds: [] }]).status
        .text,
    ).toBe("Loading context…");
  });
  it("accepts plan provenance only for the requested project and comparison", () => {
    const raw = {
      comparisonId: "cmp1",
      result: { projectId: project.id, ranking: [listing.id] },
      comparison: { synthetic: false },
    };
    expect(planContextSource(raw, project.id, "cmp1")).toEqual({
      comparisonId: "cmp1",
      synthetic: false,
      siteIds: [listing.id],
    });
    expect(planContextSource(raw, "other-project", "cmp1")).toBeNull();
    expect(planContextSource(raw, project.id, "other-comparison")).toBeNull();
    expect(
      planContextSource({ ...raw, comparison: undefined }, project.id, "cmp1")
        ?.synthetic,
    ).toBeUndefined();
  });
  it("filters async publications by both project and full route identity", () => {
    const routeKey = "/projects/houston-coffee/map?site=201%3A301";
    expect(
      reportsForRoute(
        {
          current: { projectId: project.id, routeKey, observation: search },
          stale: {
            projectId: project.id,
            routeKey: "/projects/houston-coffee/replay?",
            observation: comparison,
          },
          other: {
            projectId: "another-project",
            routeKey,
            observation: comparison,
          },
        },
        project.id,
        routeKey,
      ),
    ).toEqual([search]);
  });
});

describe("simulator context", () => {
  it("marks a failed stored load's displayed fallback as Example", () => {
    const result = context("simulator", "comparison=missing&site=other", [
      {
        kind: "simulator",
        phase: "example",
        siteId: "montrose",
        synthetic: true,
      },
    ]);
    expect(result.example).toBe(true);
    expect(result.status.text).toBe("Example data");
    expect(result.location.text).toBe("Montrose storefront");
    expect(result.qualifier).toBe("Modeled, not a forecast");
  });
  it("uses actual stored selection without borrowing a fixture address", () => {
    const result = context("simulator", "comparison=cmp1", [
      {
        kind: "simulator",
        phase: "ready",
        siteId: "saved-site",
        comparisonId: "cmp1",
        synthetic: false,
      },
    ]);
    expect(result.example).toBe(false);
    expect(result.location.text).toBe("Site saved-site · address unavailable");
    expect(result.status.text).toBe("Stored simulation");
    expect(result.scenario.href).toContain("comparison=cmp1");
  });
  it("rejects stale comparison reports and does not infer provenance", () => {
    expect(
      context("simulator", "comparison=cmp2", [
        {
          kind: "simulator",
          phase: "ready",
          comparisonId: "cmp1",
          siteId: "saved-site",
          synthetic: false,
        },
      ]).status.text,
    ).toBe("Loading context…");
    const unknown = context("simulator", "", [
      { kind: "simulator", phase: "ready", siteId: "saved-site" },
    ]);
    expect(unknown.example).toBe(false);
    expect(unknown.status.text).toBe("Simulation provenance unavailable");
    expect(context("simulator").location.text).toBe("Choose a location");
  });
});
