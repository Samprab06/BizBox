import { describe, expect, it } from "vitest";
import type { RobustnessSummary } from "@/lib/contracts/evaluation";
import { simulatorAnswer } from "./simulator-answer";

describe("simulator decision answer", () => {
  it("uses the actual saved robustness conditions verbatim, never the example delta", () => {
    const robustness: RobustnessSummary = {
      headline: "Site A leads now; Site B leads below 0.70× demand.",
      leaderSiteId: "a",
      tiedSiteIds: [],
      mostInfluential: null,
      robustTo: [],
      jevHuffAgree: null,
      missingInformation: [],
    };
    expect(
      simulatorAnswer({
        example: false,
        additionalServed: 99,
        contributionChange: 10000,
        robustness,
      }),
    ).toBe(robustness.headline);
  });
  it("keeps historical missing robustness explicit instead of inventing a threshold", () => {
    expect(
      simulatorAnswer({
        example: false,
        additionalServed: 99,
        contributionChange: 10000,
      }),
    ).toBe(
      "Recommendation robustness is unavailable for this saved comparison.",
    );
  });
  it("uses both computed service and cost directions in a qualified example without a sales number", () => {
    const answer = simulatorAnswer({
      example: true,
      additionalServed: 12,
      contributionChange: -200,
    });
    expect(answer).toContain("seeded example");
    expect(answer).toContain("12 more modeled customers");
    expect(answer).toContain("contribution after included costs is lower");
    expect(answer).not.toContain("$");
  });
});
