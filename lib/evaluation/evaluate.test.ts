import { afterEach, describe, expect, it, vi } from "vitest";
import {
  EvaluationRequestSchema,
  EvaluationResultSchema,
  SensitivityResultSchema,
  type EvaluationRequestInput,
  type EvaluationSite,
} from "@/lib/contracts/evaluation";
import {
  COMPETITORS,
  FIXTURE_PERSONA_SET,
  SITE_A,
  SITE_B,
  makeBehaviorTable,
  makeStore,
} from "@/lib/demand/fixtures";
import type { SiteConfigInput } from "@/lib/sim/contracts";
import {
  acceptanceAt,
  canonicalEvents,
  demandSourceCheck,
  evaluateSites,
  evaluateSitesResumable,
  hourlyStats,
  intervalOverlap,
  isOutdated,
  rankSites,
  repriceBehaviorTable,
  runSensitivity,
  siteRunSummary,
  summarize,
} from "./evaluate";

const hours = { openMin: 6 * 60, closeMin: 18 * 60 };

function config(
  rent: number,
  sf: number,
  overrides: Partial<SiteConfigInput> = {},
): SiteConfigInput {
  return {
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
    ...overrides,
  };
}

/** Site A: stronger corner with more demand and a much higher rent. Site B: cheaper inline space. */
function sites(withTables = true): EvaluationSite[] {
  return [
    {
      siteId: SITE_A.id,
      storefront: SITE_A,
      config: config(48, SITE_A.sizeSqft) as EvaluationSite["config"],
      ...(withTables
        ? {
            behaviorTable: makeBehaviorTable(SITE_A.id),
            behaviorTableId: "bt-a",
          }
        : {}),
    },
    {
      siteId: SITE_B.id,
      storefront: SITE_B,
      config: config(22, SITE_B.sizeSqft) as EvaluationSite["config"],
      ...(withTables
        ? {
            behaviorTable: makeBehaviorTable(SITE_B.id),
            behaviorTableId: "bt-b",
          }
        : {}),
    },
  ];
}

function request(
  overrides: Partial<EvaluationRequestInput> = {},
): EvaluationRequestInput {
  return {
    projectId: "p1",
    profileId: "profile-v1",
    profileVersion: 1,
    synthetic: true,
    city: "houston",
    category: "coffee",
    priceTier: "mid",
    personaSet: FIXTURE_PERSONA_SET,
    competitors: COMPETITORS,
    sites: sites(),
    seeds: 12,
    ...overrides,
  };
}

afterEach(() => vi.restoreAllMocks());

describe("statistics", () => {
  it("summarizes the mean and 90% interval", () => {
    const s = summarize(Array.from({ length: 20 }, (_, i) => i + 1));
    expect(s.mean).toBe(10.5);
    expect(s.low).toBe(1);
    expect(s.high).toBe(19);
    expect(s.low).toBeLessThanOrEqual(s.median);
  });

  it("measures interval overlap against the narrower interval", () => {
    expect(
      intervalOverlap(
        { mean: 5, low: 0, median: 5, high: 10 },
        { mean: 7, low: 5, median: 7, high: 9 },
      ),
    ).toBe(1);
    expect(
      intervalOverlap(
        { mean: 1, low: 0, median: 1, high: 2 },
        { mean: 9, low: 8, median: 9, high: 10 },
      ),
    ).toBe(0);
    expect(
      intervalOverlap(
        { mean: 3, low: 3, median: 3, high: 3 },
        { mean: 2, low: 0, median: 2, high: 5 },
      ),
    ).toBe(1);
  });

  it("ranks by mean contribution and marks heavily overlapping sites as tied", () => {
    const base = evaluateSites(request()).result.sites;
    const [a, b] = base;
    const tied = rankSites([
      {
        ...a!,
        monthlyContributionUsd: { mean: 100, low: 0, median: 100, high: 200 },
      },
      {
        ...b!,
        monthlyContributionUsd: { mean: 90, low: 10, median: 90, high: 190 },
      },
    ]);
    expect(tied.map((s) => s.rank)).toEqual([1, 2]);
    expect(tied[0]!.tiedWith).toEqual([b!.siteId]);
  });
});

describe("evaluateSites", () => {
  it("produces a valid, ranked comparison with intervals and one representative run per day type", () => {
    const { result, representativeDays } = evaluateSites(request());
    expect(EvaluationResultSchema.parse(result)).toEqual(result);
    expect(result.demandSource).toBe("jev");
    expect(result.jevModelVersion).toBe("jev-1.14.0");
    expect(result.behaviorTableIds).toEqual({
      "site-a": "bt-a",
      "site-b": "bt-b",
    });
    expect(result.seeds).toHaveLength(12);
    expect(result.ranking).toHaveLength(2);
    for (const site of result.sites) {
      const c = site.monthlyContributionUsd;
      expect(c.low).toBeLessThanOrEqual(c.median);
      expect(c.median).toBeLessThanOrEqual(c.high);
      expect(site.contributionBySeed).toHaveLength(12);
      expect(
        representativeDays[site.siteId]!.weekday.events.length,
      ).toBeGreaterThan(0);
      expect(site.representative.weekday.eventIds).toHaveLength(
        representativeDays[site.siteId]!.weekday.events.length,
      );
    }
    const means = result.sites.map((s) => s.monthlyContributionUsd.mean);
    expect(means).toEqual([...means].sort((x, y) => y - x));
  });

  it("re-running a stored comparison reproduces identical metrics from cached behavior tables, with no Jev calls", () => {
    const fetchSpy = vi.spyOn(globalThis, "fetch");
    const stored = EvaluationRequestSchema.parse(request());
    const first = evaluateSites(stored).result;
    const rerun = evaluateSites(JSON.parse(JSON.stringify(stored))).result;
    expect(rerun).toEqual(first);
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("falls back to Huff, labeled huff, when Jev behavior tables are unavailable", () => {
    const partial = sites();
    delete partial[1]!.behaviorTable;
    const { result } = evaluateSites(request({ sites: partial }));
    expect(result.requestedDemandSource).toBe("jev");
    expect(result.demandSource).toBe("huff");
    expect(result.fallbackReason).toMatch(/site-b/);
    expect(result.jevModelVersion).toBeNull();
    expect(result.sites.every((s) => s.demandSource === "huff")).toBe(true);
    expect(result.sites.every((s) => s.monthlyServedCustomers.mean > 0)).toBe(
      true,
    );
  });

  it("marks comparisons from an older profile version as outdated", () => {
    const { result } = evaluateSites(request({ profileVersion: 2 }));
    expect(isOutdated(result, 2)).toBe(false);
    expect(isOutdated(result, 3)).toBe(true);
  });

  it("resumes after a deadline without recomputing finished sites, matching a one-shot run", async () => {
    let clock = 0;
    const finished: string[] = [];
    const first = await evaluateSitesResumable(request(), {
      now: () => clock,
      deadlineAt: 1,
      onSite: (id) => {
        finished.push(id);
        clock = 5;
      },
    });
    expect(first.status).toBe("partial");
    if (first.status !== "partial") return;
    expect(first.pendingSiteIds).toEqual(["site-b"]);
    const resumed = await evaluateSitesResumable(request(), {
      completed: first.completed,
      onSite: (id) => {
        finished.push(id);
      },
    });
    expect(finished).toEqual(["site-a", "site-b"]);
    expect(resumed.status).toBe("complete");
    if (resumed.status === "complete")
      expect(resumed.run.result).toEqual(evaluateSites(request()).result);
  });

  it("evaluates 8 sites x 30 seeds x 2 day types quickly with cached behavior tables", () => {
    const eight: EvaluationSite[] = Array.from({ length: 8 }, (_, i) => {
      const store = makeStore(
        `site-${i}`,
        (i % 4) * 0.6 - 0.9,
        Math.floor(i / 4) * 0.7 - 0.3,
        { sizeSqft: 1200 + i * 100 },
      );
      return {
        siteId: store.id,
        storefront: store,
        config: config(24 + i * 3, store.sizeSqft) as EvaluationSite["config"],
        behaviorTable: makeBehaviorTable(store.id),
      };
    });
    const started = performance.now();
    const { result } = evaluateSites(request({ sites: eight, seeds: 30 }));
    const elapsed = performance.now() - started;
    expect(result.sites).toHaveLength(8);
    expect(result.seeds).toHaveLength(30);
    expect(elapsed).toBeLessThan(30_000);
  }, 60_000);
});

describe("sensitivity", () => {
  it("a market-share sweep changes the ranking at a reported break-even value", () => {
    const values = [0.25, 0.5, 1, 1.5, 2, 3];
    const s = runSensitivity(request(), "market_share_scale", values, {
      seeds: 8,
    });
    expect(SensitivityResultSchema.parse(s)).toEqual(s);
    expect(s.topChanges).toBe(true);
    expect(s.breakEven).not.toBeNull();
    const be = s.breakEven!;
    expect(be.value).toBeGreaterThanOrEqual(values[0]!);
    expect(be.value).toBeLessThanOrEqual(values[values.length - 1]!);
    expect(be.fromSiteId).not.toBe(be.toSiteId);
    // Low demand favors the cheap space; high demand the stronger, pricier corner.
    expect(s.points[0]!.topSiteId).toBe("site-b");
    expect(s.points[s.points.length - 1]!.topSiteId).toBe("site-a");
    expect(s.conclusion).toMatch(/changes from/);
  });

  it("rent ±10% reports whether the top site holds", () => {
    const s = runSensitivity(request(), "rent", [0.9, 1, 1.1], { seeds: 6 });
    expect(s.unit).toBe("multiplier");
    expect(s.points.map((p) => p.value)).toEqual([0.9, 1, 1.1]);
    if (!s.topChanges) expect(s.conclusion).toMatch(/stays the top site/);
  });

  it("price re-reads cached price acceptance from the behavior table", () => {
    const table = makeBehaviorTable("site-a");
    expect(acceptanceAt(table.personas[0]!.priceAcceptance, 5)).toBeCloseTo(
      0.75,
    );
    const repriced = repriceBehaviorTable(table, 4, 6);
    expect(repriced.personas[0]!.visitsPerMonth).toBeCloseTo(
      (table.personas[0]!.visitsPerMonth * 0.6) / 0.9,
    );
    const s = runSensitivity(request(), "price", [5, 6.5, 8], { seeds: 4 });
    expect(s.unit).toBe("usd");
    const served = s.points.map((p) => p.meanContributionUsd["site-a"]!);
    expect(new Set(served).size).toBe(3);
  });
});

describe("demand source check and run summaries", () => {
  it("reruns with Huff-only demand and reports whether the ranking matches", () => {
    const check = demandSourceCheck(request({ seeds: 6 }));
    expect(check.primary).toBe("jev");
    expect(check.huffRanking).toHaveLength(2);
    expect(typeof check.rankingMatches).toBe("boolean");
    expect(check.topMatches).toBe(
      check.primaryRanking[0] === check.huffRanking[0],
    );
  });

  it("summarizes a run by hour and maps engine events to the canonical vocabulary", () => {
    const { result, representativeDays } = evaluateSites(request({ seeds: 4 }));
    const site = result.sites[0]!;
    const day = representativeDays[site.siteId]!.weekday;
    const hourly = hourlyStats(day);
    expect(hourly.reduce((s, h) => s + h.arrivals, 0)).toBe(
      day.metrics.arrivals,
    );
    expect(hourly.reduce((s, h) => s + h.served, 0)).toBe(day.metrics.served);
    expect(hourly.every((h) => h.utilization >= 0 && h.utilization <= 1)).toBe(
      true,
    );
    expect(siteRunSummary(result, site.representative.weekday.runId)).toEqual(
      site.representative.weekday,
    );
    expect(siteRunSummary(result, "missing")).toBeNull();
    const events = canonicalEvents(day.events);
    expect(events.filter((e) => e.type === "arrived")).toHaveLength(
      day.metrics.arrivals,
    );
    expect(events.filter((e) => e.type === "abandoned")).toHaveLength(
      day.metrics.abandoned,
    );
  });
});

describe("service-time wiring (HAC-64)", () => {
  it("the configured mean service time drives actual service durations, with comparable draws", () => {
    const withMean = (meanServiceMin: number) =>
      request({
        seeds: 1,
        sites: sites().map((s) => ({
          ...s,
          config: { ...s.config, service: { meanServiceMin } },
        })),
      });
    /** Service duration per customer ID for the representative weekday of site-a. */
    const durations = (meanServiceMin: number) => {
      const { representativeDays } = evaluateSites(withMean(meanServiceMin));
      const started = new Map<string, number>();
      const out = new Map<string, number>();
      for (const e of representativeDays["site-a"]!.weekday.events) {
        if (e.type === "service_start") started.set(e.customerId, e.timeMin);
        if (e.type === "completion" && started.has(e.customerId))
          out.set(e.customerId, e.timeMin - started.get(e.customerId)!);
      }
      return out;
    };
    const short = durations(2);
    const long = durations(10);
    const mean = (xs: number[]) => xs.reduce((a, b) => a + b, 0) / xs.length;
    expect(short.size).toBeGreaterThan(0);
    expect(mean([...short.values()])).toBeGreaterThan(1);
    expect(mean([...short.values()])).toBeLessThan(3.5);
    // Same seed, same underlying draws: each customer served in both runs takes 5x as long.
    const common = [...short.keys()].filter((id) => long.has(id));
    expect(common.length).toBeGreaterThan(0);
    for (const id of common)
      expect(long.get(id)! / short.get(id)!).toBeCloseTo(5, 5);
  });
});

describe("demand provenance chain (HAC-61)", () => {
  it("labels modelled outputs as modelled and states the derivation", () => {
    const jev = evaluateSites(request({ seeds: 2 })).result;
    expect(jev.derivation).toEqual({
      inputs: "default",
      transformation: "synthetic_personas",
      behaviorModel: "jev",
      calibration: "none",
      output: "modelled_arrivals",
    });
    const real = evaluateSites(
      request({ seeds: 2, synthetic: false, demandSource: "huff" }),
    ).result;
    expect(real.derivation).toMatchObject({
      inputs: "public",
      behaviorModel: "huff",
      calibration: "none",
    });
  });
});
