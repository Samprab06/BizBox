import { describe, expect, it } from "vitest";
import {
  EvaluationRequestSchema,
  type SensitivityResult,
} from "@/lib/contracts/evaluation";
import {
  COMPETITORS,
  FIXTURE_PERSONA_SET,
  SITE_A,
  SITE_B,
  makeBehaviorTable,
} from "@/lib/demand/fixtures";
import { evaluateSites } from "./evaluate";
import {
  autoSensitivities,
  robustnessSummary,
  RobustnessSummarySchema,
} from "./robustness";

const hours = { openMin: 360, closeMin: 1080 };
const config = (rent: number, sf: number) => ({
  hours: { weekday: hours, weekend: hours },
  stations: { planned: 2, usableSf: sf, sfPerStation: 250 },
  prices: { avgTicketUsd: 6.5 },
  staff: { headcount: 2, wageUsdPerHour: 16 },
  costs: { cogsPctOfRevenue: 0.28 },
  lease: {
    sf,
    askingRentUsdPerSfYear: rent,
    tripleNet: false,
    buildoutUsd: 30_000,
    leaseTermMonths: 60,
  },
  calendar: { weekdayDaysPerMonth: 21.7, weekendDaysPerMonth: 8.7 },
});
const request = EvaluationRequestSchema.parse({
  projectId: "p1",
  profileId: "profile-1",
  profileVersion: 1,
  synthetic: true,
  city: "houston",
  category: "coffee",
  priceTier: "mid",
  personaSet: FIXTURE_PERSONA_SET,
  competitors: COMPETITORS,
  seeds: 4,
  sites: [
    {
      siteId: SITE_A.id,
      storefront: SITE_A,
      config: config(48, 1800),
      behaviorTable: makeBehaviorTable(SITE_A.id),
    },
    {
      siteId: SITE_B.id,
      storefront: SITE_B,
      config: config(22, 1300),
      behaviorTable: makeBehaviorTable(SITE_B.id),
    },
  ],
});

describe("robustness summary (HAC-62)", () => {
  it("names the assumption that most changes the ranking, from real sweeps", () => {
    const result = evaluateSites(request).result;
    const sweeps = autoSensitivities(request);
    expect(sweeps.map((s) => s.assumption)).toEqual([
      "market_share_scale",
      "ticket_size",
      "rent",
      "price",
    ]);
    const summary = RobustnessSummarySchema.parse(
      robustnessSummary({
        request,
        result,
        sensitivities: sweeps,
        demandSourceCheck: { topMatches: true },
      }),
    );
    expect(summary.leaderSiteId).toBe(result.ranking[0]);
    expect(summary.jevHuffAgree).toBe(true);
    if (summary.mostInfluential) {
      expect(summary.headline).toMatch(
        /leads under current assumptions; .* leads if /,
      );
      expect(summary.missingInformation.length).toBeGreaterThan(0);
    } else expect(summary.headline).toMatch(/leads across every tested change/);
  });

  const sweep = (
    assumption: SensitivityResult["assumption"],
    value: number,
    from: string,
    to: string,
    unit: "multiplier" | "usd" = "multiplier",
  ): SensitivityResult => ({
    assumption,
    unit,
    baselineTopSiteId: to,
    points: [
      {
        value: value * 0.9,
        topSiteId: from,
        ranking: [from, to],
        meanContributionUsd: {},
      },
      {
        value: value * 1.1,
        topSiteId: to,
        ranking: [to, from],
        meanContributionUsd: {},
      },
    ],
    topChanges: true,
    breakEven: { value, fromSiteId: from, toSiteId: to },
    conclusion: "flips",
  });

  it("picks the closest break-even and phrases its direction from the leader's side", () => {
    const result = structuredClone(evaluateSites(request).result);
    result.ranking = ["site-a", "site-b"];
    result.sites.forEach((s) => (s.tiedWith = []));
    const summary = robustnessSummary({
      request,
      result,
      sensitivities: [
        sweep("rent", 1.4, "site-b", "site-a"),
        sweep("market_share_scale", 0.8, "site-b", "site-a"),
      ],
      label: (id) => (id === "site-a" ? "Corner A" : "Inline B"),
    });
    expect(summary.mostInfluential).toMatchObject({
      assumption: "market_share_scale",
      relativeDistance: expect.closeTo(0.2, 6),
    });
    expect(summary.headline).toBe(
      "Corner A leads under current assumptions; Inline B leads if demand (market share) falls below 0.80× its current level.",
    );
    expect(summary.missingInformation[0]).toMatch(/calibrate demand/);
  });

  it("reports ties, robustness and Jev/Huff disagreement", () => {
    const result = structuredClone(evaluateSites(request).result);
    result.sites.find((s) => s.siteId === result.ranking[0])!.tiedWith = [
      result.ranking[1]!,
    ];
    const tied = robustnessSummary({
      request,
      result,
      sensitivities: [],
      demandSourceCheck: { topMatches: false },
    });
    expect(tied.headline).toMatch(/effectively tied/);
    expect(tied.jevHuffAgree).toBe(false);
    expect(tied.missingInformation[0]).toMatch(/Jev and Huff/);

    const clean = structuredClone(evaluateSites(request).result);
    clean.sites.forEach((s) => (s.tiedWith = []));
    const calm = robustnessSummary({
      request,
      result: clean,
      sensitivities: [
        {
          ...sweep("rent", 1, "site-a", "site-b"),
          topChanges: false,
          breakEven: null,
        },
      ],
    });
    expect(calm.headline).toMatch(/leads across every tested change \(rent\)/);
    expect(calm.robustTo).toEqual(["rent"]);
  });
});
