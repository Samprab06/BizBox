import { describe, expect, it } from "vitest";
import { agentViewForRoute } from "./agent-view-context";
import type { WorkspaceReport } from "./workspace-context";
const projectId = "p";
const pathname = "/projects/p/workspace";
const listing = {
  id: "site-1",
  name: "untrusted label",
  address: "private",
  synthetic: false,
};
const reports: Record<string, WorkspaceReport> = {
  current: {
    projectId,
    routeKey: `${pathname}?site=site-1`,
    observation: { kind: "search", phase: "live", candidates: [listing] },
  },
  stale: {
    projectId,
    routeKey: "/projects/p/comparison?",
    observation: {
      kind: "comparison",
      phase: "ready",
      comparisonId: "stale",
      siteIds: [],
      candidates: [],
    },
  },
};
describe("agent view from workspace registry", () => {
  it("serializes displayed IDs without listing labels or stale reports", () => {
    expect(
      agentViewForRoute(projectId, pathname, "site=site-1", reports),
    ).toEqual({
      stage: "workspace",
      step: "locations",
      phase: "live",
      siteId: "site-1",
      candidateIds: ["site-1"],
    });
  });
  it("Scene 1: adds the step, the visible listings' facts and the shortlist", () => {
    const view = agentViewForRoute(projectId, pathname, "step=compare&site=site-1", {
      search: {
        projectId,
        routeKey: `${pathname}?step=compare&site=site-1`,
        observation: {
          kind: "search",
          phase: "live",
          candidates: [listing, { ...listing, id: "site-2" }],
        },
      },
      comparison: {
        projectId,
        routeKey: `${pathname}?step=compare&site=site-1`,
        observation: {
          kind: "comparison",
          phase: "ready",
          siteIds: [],
          shortlistIds: ["site-2", "elsewhere"],
          candidates: [
            { ...listing, address: "1 Main St", monthlyRentUsd: 4200, sqft: 1200, score: 71 },
            { ...listing, id: "site-2", address: "2 Main St", sqft: Number.NaN },
          ],
        },
      },
    });
    expect(view).toMatchObject({
      step: "compare",
      candidateIds: ["site-1", "site-2"],
      candidates: [
        { id: "site-1", address: "1 Main St", monthlyRentUsd: 4200, sqft: 1200, score: 71 },
        { id: "site-2", address: "2 Main St" },
      ],
      shortlistIds: ["site-2"],
    });
    expect(view.candidates?.[1]).not.toHaveProperty("sqft");
    expect(agentViewForRoute(projectId, "/projects/p/intake", "", {})).toEqual({
      stage: "intake",
      step: "questions",
    });
  });
  it("omits URL-only and example IDs", () => {
    expect(
      agentViewForRoute(projectId, pathname, "site=spoofed", reports),
    ).toEqual({ stage: "workspace", step: "locations" });
    expect(
      agentViewForRoute(projectId, pathname, "site=site-1", {
        ...reports,
        current: {
          ...reports.current,
          observation: {
            kind: "search",
            phase: "example",
            candidates: [listing],
          },
        },
      }),
    ).toEqual({ stage: "workspace", step: "locations", phase: "example" });
  });
  it("caps candidates and uses the displayed workspace default for an ambiguous URL", () => {
    const observation = {
      kind: "search",
      phase: "live",
      candidates: Array.from({ length: 10 }, (_, i) => ({
        ...listing,
        id: `s${i}`,
      })),
    } as const;
    const view = agentViewForRoute(projectId, pathname, "site=s0&site=s1", {
      current: {
        projectId,
        routeKey: `${pathname}?site=s0&site=s1`,
        observation: {
          ...observation,
          candidates: [...observation.candidates],
        },
      },
    });
    expect(view.candidateIds).toHaveLength(8);
    expect(view.siteId).toBe("s0");
  });
});

it("combines replay selection with its active stored comparison rather than fresh search candidates", () => {
  const path = "/projects/p/replay";
  const key = `${path}?site=old-site&comparison=saved`;
  expect(
    agentViewForRoute("p", path, "site=old-site&comparison=saved", {
      replay: {
        projectId: "p",
        routeKey: key,
        observation: {
          kind: "replay",
          phase: "ready",
          siteId: "old-site",
          synthetic: false,
        },
      },
      stored: {
        projectId: "p",
        routeKey: key,
        observation: {
          kind: "stored",
          phase: "ready",
          comparisonId: "saved",
          synthetic: false,
          siteIds: ["old-site"],
          candidates: [],
        },
      },
    }),
  ).toEqual({
    stage: "replay",
    phase: "ready",
    comparisonId: "saved",
    siteId: "old-site",
    candidateIds: ["old-site"],
  });
});

it("drops all stale IDs for mismatched or ambiguous comparison queries", () => {
  for (const search of [
    "comparison=other&site=site-1",
    "comparison=stored&comparison=stored&site=site-1",
  ]) {
    const path = "/projects/p/comparison";
    expect(
      agentViewForRoute("p", path, search, {
        source: {
          projectId: "p",
          routeKey: `${path}?${search}`,
          observation: {
            kind: "comparison",
            phase: "ready",
            comparisonId: "stored",
            synthetic: false,
            candidates: [listing],
            siteIds: [listing.id],
          },
        },
      }),
    ).toEqual({ stage: "comparison", phase: "ready" });
  }
});

it("matches the workspace default first displayed candidate when the URL has no selection", () => {
  const path = "/projects/p/workspace";
  const view = agentViewForRoute("p", path, "", {
    current: {
      projectId: "p",
      routeKey: `${path}?`,
      observation: { kind: "search", phase: "live", candidates: [listing] },
    },
  });
  expect(view.siteId).toBe(listing.id);
});

it("does not claim a different live site when the displayed workspace selection is synthetic", () => {
  const path = "/projects/p/workspace";
  const view = agentViewForRoute("p", path, "", {
    source: {
      projectId: "p",
      routeKey: `${path}?`,
      observation: {
        kind: "search",
        phase: "live",
        candidates: [{ ...listing, id: "example", synthetic: true }, listing],
      },
    },
  });
  expect(view.siteId).toBeUndefined();
});
