import { describe, expect, it } from "vitest";
import { siteDemandLabel } from "./demand-label";

const fellBack = {
  requestedDemandSource: "jev",
  demandSource: "huff",
} as const;

describe("siteDemandLabel", () => {
  it("names the failed persona count next to the site", () => {
    expect(
      siteDemandLabel(fellBack, {
        jevPanel: { personaCount: 64, failedPersonaCount: 3 },
      }),
    ).toBe("Huff (Jev failed for 3 of 64 personas)");
  });
  it("explains a healthy site that fell back because another site failed", () => {
    const ok = { jevPanel: { personaCount: 64, failedPersonaCount: 0 } };
    const bad = { jevPanel: { personaCount: 64, failedPersonaCount: 2 } };
    expect(siteDemandLabel(fellBack, ok, [ok, bad])).toMatch(
      /another site's panel was incomplete/,
    );
  });
  it("says Jev was unavailable when no panel counts exist", () => {
    expect(siteDemandLabel(fellBack, {})).toBe("Huff (Jev unavailable)");
  });
  it("says nothing when Jev answered or Huff was requested", () => {
    expect(
      siteDemandLabel(
        { requestedDemandSource: "jev", demandSource: "jev" },
        {},
      ),
    ).toBeNull();
    expect(
      siteDemandLabel(
        { requestedDemandSource: "huff", demandSource: "huff" },
        {},
      ),
    ).toBeNull();
  });
});
