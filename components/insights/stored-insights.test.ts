import { describe, expect, it } from "vitest";
import {
  liveComparisonPayload,
  liveComparisonId,
  liveCandidateIds,
} from "@/tests/e2e/live-comparison-fixtures";
import { insightsReference, parseStoredInsights } from "./stored-insights";

const identity = {
  projectId: "houston-coffee",
  comparisonId: liveComparisonId,
  siteId: liveCandidateIds[0],
};

describe("stored Insights selection", () => {
  it("uses an explicit saved link without local intake and rejects ambiguous links", () => {
    expect(
      insightsReference(
        "https://example.test/site?comparison=chosen",
        null,
        identity.projectId,
      ),
    ).toEqual({ comparisonId: "chosen", reference: null });
    expect(
      insightsReference(
        "https://example.test/site?comparison=a&comparison=b",
        null,
        identity.projectId,
      ).comparisonId,
    ).toBeUndefined();
    expect(
      insightsReference(
        "https://example.test/site?comparison=chosen",
        "{",
        identity.projectId,
      ).comparisonId,
    ).toBe("chosen");
  });

  it("reads the retained multi-seed aggregate without deriving bands from representatives", () => {
    const value = parseStoredInsights(liveComparisonPayload, identity);
    expect(value.site.insights?.seedCount).toBe(3);
    expect(value.site.insights?.siteId).toBe(identity.siteId);
    const legacy = structuredClone(liveComparisonPayload);
    delete legacy.result.sites[0].insights;
    expect(parseStoredInsights(legacy, identity).site.insights).toBeUndefined();
  });

  it("rejects wrong comparison, project, site, profile and nested insight identities", () => {
    for (const wrong of [
      { comparisonId: "another" },
      { projectId: "another" },
      { siteId: "another" },
      {
        reference: {
          projectId: identity.projectId,
          comparisonId: liveComparisonId,
          profileId: "another",
          profileVersion: 1,
        },
      },
      {
        reference: {
          projectId: identity.projectId,
          comparisonId: liveComparisonId,
          profileId: liveComparisonPayload.result.profileId,
          profileVersion: 2,
        },
      },
    ])
      expect(() =>
        parseStoredInsights(liveComparisonPayload, { ...identity, ...wrong }),
      ).toThrow();
    const wrong = structuredClone(liveComparisonPayload);
    wrong.result.sites[0].insights!.siteId = "another";
    expect(() => parseStoredInsights(wrong, identity)).toThrow();
  });

  it("rejects aggregates with a different seed count or source label", () => {
    const wrongCount = structuredClone(liveComparisonPayload);
    wrongCount.result.seeds.push(999);
    expect(() => parseStoredInsights(wrongCount, identity)).toThrow();
    const wrongSource = structuredClone(liveComparisonPayload);
    wrongSource.comparison.synthetic = false;
    expect(() => parseStoredInsights(wrongSource, identity)).toThrow();
  });
});
