import { describe, expect, it } from "vitest";
import { SpatialDraftSchema } from "@/lib/contracts/spatial";
import {
  hasReviewedInterior,
  InteriorFlowSchema,
  initialFlowState,
  reachStep,
  resetAfter,
  withInterior,
} from "@/lib/client/flow-steps";

const draft = SpatialDraftSchema.parse({
  version: 1,
  id: "d",
  revision: 0,
  projectId: "p",
  siteId: "s",
  city: "los_angeles",
  timezone: "America/Los_Angeles",
  category: "coffee",
  room: { widthM: 10, depthM: 8, source: "assumed" },
  entrance: { x: 1, z: 0 },
  servicePoint: { x: 5, z: 6 },
  items: [],
  settings: {
    openMin: 480,
    closeMin: 720,
    arrivals: 50,
    serviceMin: 4,
    staff: 2,
    averageTicketUsd: 6,
    wageUsdPerHour: 18,
    cogsFraction: 0.3,
  },
  limitations: [],
});
const interior = {
  comparisonId: "c",
  siteId: "s",
  baseline: draft,
  draft,
  ranRevision: 0,
  reviewedRevision: 0,
};

describe("interior report eligibility", () => {
  it("requires current run/review and exact project/site/comparison scope", () => {
    expect(
      hasReviewedInterior(interior, {
        projectId: "p",
        siteId: "s",
        comparisonId: "c",
      }),
    ).toBe(true);
    for (const scope of [
      { projectId: "other", siteId: "s", comparisonId: "c" },
      { projectId: "p", siteId: "other", comparisonId: "c" },
      { projectId: "p", siteId: "s", comparisonId: "other" },
    ])
      expect(hasReviewedInterior(interior, scope)).toBe(false);
    expect(
      hasReviewedInterior(
        { ...interior, draft: { ...draft, revision: 1 } },
        { projectId: "p", siteId: "s", comparisonId: "c" },
      ),
    ).toBe(false);
  });
  it("locks final report after edits and discards interior after exterior change", () => {
    const state = withInterior(reachStep(initialFlowState(), "finalize"), {
      ...interior,
      draft: { ...draft, revision: 1 },
      ranRevision: null,
      reviewedRevision: null,
    });
    expect(state.reached).not.toContain("finalize");
    expect(resetAfter(state, "compare").interior).toBeUndefined();
  });
});

import { createInteriorFlow } from "./interior-experiment-state";
import type { BusinessProfile } from "@/lib/contracts";
const profile = {
  projectId: "p",
  category: "fitness",
  city: "Los Angeles",
  operatingHours: { openMinute: 600, closeMinute: 900 },
  capacity: { servers: { value: 3 }, serviceMinutes: { value: 45 } },
  economics: { averageTicketCents: { value: 2000 } },
  derivedDefaults: {
    wageRateCentsPerHour: { value: 2200 },
    cogsFraction: { value: 0.1 },
  },
} as BusinessProfile;
it("creates a scoped interior from actual city/category and explicit business inputs", () => {
  const state = createInteriorFlow({
    projectId: "p",
    siteId: "s",
    comparisonId: "c",
    profile,
  });
  expect(state.draft.city).toBe("los_angeles");
  expect(state.draft.category).toBe("fitness");
  expect(state.draft.settings.staff).toBe(3);
  expect(state.draft.settings.serviceMin).toBe(45);
  expect(state.draft.settings.averageTicketUsd).toBe(20);
  expect(state.reviewedRevision).toBeNull();
});

import {
  finalizeWhileCurrent,
  matchesInteriorScope,
} from "./interior-experiment-state";
it("discards a final report completed after an intervening layout edit", async () => {
  let current = interior;
  let resolve!: (value: string) => void;
  const pending = finalizeWhileCurrent(
    interior,
    () =>
      new Promise<string>((r) => {
        resolve = r;
      }),
    () => current,
    () => "c",
  );
  current = {
    ...current,
    draft: { ...draft, revision: 1 },
    ranRevision: null as never,
    reviewedRevision: null as never,
  };
  resolve("stale report");
  expect(await pending).toBeNull();
});
it("rejects stale FDE layout/comparison scopes", () => {
  expect(
    matchesInteriorScope(interior, {
      siteId: "s",
      comparisonId: "c",
      draftId: "d",
      expectedRevision: 0,
    }),
  ).toBe(true);
  expect(
    matchesInteriorScope(interior, {
      siteId: "s",
      comparisonId: "old",
      draftId: "d",
      expectedRevision: 0,
    }),
  ).toBe(false);
  expect(
    matchesInteriorScope(interior, {
      siteId: "s",
      comparisonId: "c",
      draftId: "d",
      expectedRevision: 1,
    }),
  ).toBe(false);
});
it("requires a current layout run even when a legacy reference was reviewed", () => {
  const referenceOnly = {
    ...interior,
    ranRevision: null,
    reviewedRevision: null,
    reference: {
      modelId: "qfmMbTLt4Bo" as const,
      selectedPlan: 1 as const,
      reviewed: true,
    },
  };
  const scope = { projectId: "p", siteId: "s", comparisonId: "c" };
  expect(hasReviewedInterior(referenceOnly, scope)).toBe(false);
  expect(
    hasReviewedInterior(
      { ...referenceOnly, draft: { ...draft, revision: 1 } },
      scope,
    ),
  ).toBe(false);
});
import { matchesReferenceReview } from "./interior-experiment-state";
it("rejects a reference action after a newer reference selection/review", () => {
  const before = {
    modelId: "qfmMbTLt4Bo" as const,
    selectedPlan: 0 as const,
    reviewed: false,
  };
  const after = { ...before, selectedPlan: 1 as const };
  expect(matchesReferenceReview(undefined, null)).toBe(true);
  expect(matchesReferenceReview(before, before)).toBe(true);
  expect(matchesReferenceReview(after, before)).toBe(false);
  expect(matchesReferenceReview({ ...before, reviewed: true }, before)).toBe(
    false,
  );
});
it("keeps the chosen-site rationale while the founder reviews the interior", () => {
  const state = createInteriorFlow({
    projectId: "p",
    siteId: "s",
    comparisonId: "c",
    profile,
    selectionRationale: "Higher modeled contribution.",
  });
  expect(state.selectionRationale).toBe("Higher modeled contribution.");
});

import { prepareInteriorFlow } from "./interior-experiment-state";
import type { InteriorResponse } from "@/lib/contracts/interior";
const fallback: InteriorResponse = {
  kind: "modeled",
  provenance: {
    origin: "default",
    provider: "modeled",
    mode: "live",
    scope: "space",
    description: "No selected scan",
    limitations: [],
  },
};
it("stores the selected source and invalidates old reference-only acceptance", () => {
  const current = {
    ...interior,
    reference: {
      modelId: "qfmMbTLt4Bo" as const,
      selectedPlan: 1 as const,
      reviewed: true,
    },
  };
  const next = prepareInteriorFlow(current, fallback);
  expect(next.source).toEqual(fallback);
  expect(next.ranRevision).toBeNull();
  expect(next.reviewedRevision).toBeNull();
  expect(next.reference).toBeUndefined();
  expect(
    hasReviewedInterior(
      { ...next, reference: current.reference },
      { projectId: "p", siteId: "s", comparisonId: "c" },
    ),
  ).toBe(false);
});
it("does not overwrite furniture edits when selected-source metadata arrives", () => {
  const changed = {
    ...draft,
    revision: 1,
    settings: { ...draft.settings, staff: 3 },
  };
  const next = prepareInteriorFlow({ ...interior, draft: changed }, fallback);
  expect(next.draft).toEqual(changed);
  expect(next.baseline).toEqual(draft);
});
it("repeated source resolution preserves current reviewed results", () => {
  const current = { ...interior, source: fallback };
  expect(prepareInteriorFlow(current, fallback)).toBe(current);
});
it("does not store viewer keys as report evidence", () => {
  const response: InteriorResponse = {
    kind: "scan",
    modelId: "Synthetic01",
    showcaseParams: { sdkKey: "client-app-key" },
    provenance: fallback.provenance,
  };
  const next = prepareInteriorFlow(
    { ...interior, ranRevision: null, reviewedRevision: null },
    response,
  );
  expect(next.source).not.toHaveProperty("showcaseParams");
  expect(response).toHaveProperty("showcaseParams");
});

it("preserves reviewed experiments when only source retrieval metadata refreshes", () => {
  const first: InteriorResponse = { ...fallback, provenance: { ...fallback.provenance, retrievedAt: "2026-11-15T10:00:00.000Z" } };
  const refreshed: InteriorResponse = { ...fallback, provenance: { ...fallback.provenance, retrievedAt: "2026-11-15T10:10:00.000Z" } };
  const current = { ...interior, source: first };
  expect(prepareInteriorFlow(current, refreshed)).toBe(current);
  expect(prepareInteriorFlow(current, { ...refreshed, provenance: { ...refreshed.provenance, limitations: ["Actual geometry is no longer available"] } }).reviewedRevision).toBeNull();
});

it("canonicalizes the new question before native-load handoff fingerprinting", () => {
  const raw = {...interior, experimentQuestion:"What happens if I add a table here?", ranRevision:null, reviewedRevision:null};
  const queued = InteriorFlowSchema.parse(raw);
  const stored = withInterior(initialFlowState(),queued).interior!;
  expect(JSON.stringify(stored)).toBe(JSON.stringify(queued));
  expect(stored.experimentQuestion).toBe(raw.experimentQuestion);
});
