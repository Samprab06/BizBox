import { describe, expect, it, vi } from "vitest";
import { SITE_A, SITE_B } from "@/lib/demand/fixtures";
import { buildLocationPlan } from "@/lib/agent/plan";
import { fixture } from "@/lib/agent/__fixtures__/plan";
import type { EvaluationResult } from "@/lib/contracts/evaluation";
import {
  FinalPlanSummarySchema,
  type GroundedLocationPlan,
} from "@/lib/contracts/plan";
import {
  DEFAULT_RATIONALE,
  buildFinalPlanSummary,
  defaultNextSteps,
  deriveNextSteps,
  deriveRisks,
  describeTweaks,
  fetchGroundedPlan,
  formatClock,
  formatCount,
  formatFinalizedAt,
  formatMinutes,
  formatRange,
  formatUsd,
  formatUsdCents,
  groundedPlanUrl,
  isWideRange,
  pickRunnerUp,
  stripCitations,
  toSummaryRange,
} from "./final-plan";

const NOW = new Date("2026-11-15T14:30:00.000Z");
const addresses = {
  [SITE_A.id]: "100 Main St, Unit 1",
  [SITE_B.id]: "200 Elm St, Unit 3",
};

/** A real saved comparison (Huff, two sites) with controllable metrics. */
function setup() {
  const input = fixture();
  const result = input.comparison.evaluation.result;
  for (const site of result.sites) {
    site.demandSource = "jev";
    site.monthlyServedCustomers = {
      mean: 3000,
      low: 2800,
      median: 3000,
      high: 3200,
    };
    site.weekdayMeanWaitMin = { mean: 2.5, low: 1, median: 2.5, high: 4 };
  }
  result.demandSource = "jev";
  result.requestedDemandSource = "jev";
  result.fallbackReason = null;
  return { input, result };
}

const build = (
  result: EvaluationResult,
  extra: Partial<Parameters<typeof buildFinalPlanSummary>[0]> = {},
) =>
  buildFinalPlanSummary({
    projectId: "p1",
    comparisonId: "comparison-a",
    chosenSiteId: SITE_A.id,
    rationale: "Best morning traffic and the lowest risk.",
    result,
    addresses,
    now: NOW,
    ...extra,
  });

describe("formatting helpers", () => {
  it("formats counts, USD and minutes with Intl", () => {
    expect(formatCount(12_345.6)).toBe("12,346");
    expect(formatCount(-0.2)).toBe("0");
    expect(formatUsd(12_400)).toBe("$12,400");
    expect(formatUsd(-800.4)).toBe("-$800");
    expect(formatUsdCents(6.5)).toBe("$6.50");
    expect(formatMinutes(4.25)).toBe("4.3 min");
    expect(formatMinutes(-1)).toBe("0.0 min");
    expect(formatRange({ low: 1000, high: 2000 }, formatUsd)).toBe(
      "$1,000–$2,000",
    );
  });
  it("prints minutes of the day as h:mm clocks", () => {
    expect(formatClock(0)).toBe("12:00 AM");
    expect(formatClock(420)).toBe("7:00 AM");
    expect(formatClock(450)).toBe("7:30 AM");
    expect(formatClock(720)).toBe("12:00 PM");
    expect(formatClock(1140)).toBe("7:00 PM");
    expect(formatClock(1439)).toBe("11:59 PM");
    expect(formatClock(1440)).toBe("12:00 AM");
  });
  it("formats the finalized date and keeps unparseable strings", () => {
    expect(formatFinalizedAt(NOW.toISOString())).toMatch(/Nov 15, 2026/);
    expect(formatFinalizedAt("not a date")).toBe("not a date");
  });
  it("describes tweaks in a fixed order", () => {
    expect(describeTweaks(undefined)).toEqual([]);
    expect(
      describeTweaks({
        monthlyRentUsd: 4200,
        staff: 1,
        priceUsd: 6.5,
        hours: { openMinute: 420, closeMinute: 1140 },
      }),
    ).toEqual([
      { key: "hours", label: "Hours", value: "7:00 AM–7:00 PM" },
      { key: "priceUsd", label: "Average ticket", value: "$6.50" },
      { key: "staff", label: "Staff", value: "1 person per open hour" },
      { key: "monthlyRentUsd", label: "Rent", value: "$4,200 / month" },
    ]);
    expect(describeTweaks({ staff: 3 })[0].value).toBe(
      "3 people per open hour",
    );
  });
  it("strips plan citations", () => {
    expect(stripCitations("Count traffic. [comparison:abc]")).toBe(
      "Count traffic.",
    );
    expect(stripCitations("A [run:r1]  and  B [evidence:e]")).toBe("A and B");
  });
});

describe("range helpers", () => {
  it("drops the median and orders low/high", () => {
    expect(toSummaryRange({ mean: 5, low: 9, high: 1 })).toEqual({
      mean: 5,
      low: 1,
      high: 9,
    });
  });
  it("flags wide ranges by ratio, or by spread when the range touches zero", () => {
    expect(isWideRange({ mean: 3000, low: 2800, high: 3200 })).toBe(false);
    expect(isWideRange({ mean: 1500, low: 1000, high: 2000 })).toBe(true);
    expect(isWideRange({ mean: 5, low: 5, high: 5 })).toBe(false);
    expect(isWideRange({ mean: 1000, low: -100, high: 1500 })).toBe(true);
    expect(isWideRange({ mean: 1000, low: -10, high: 50 })).toBe(false);
    expect(isWideRange({ mean: 0, low: -1, high: 1 })).toBe(true);
  });
});

describe("runner-up selection", () => {
  it("takes the best ranked site other than the chosen one", () => {
    const { result } = setup();
    expect(pickRunnerUp(result, SITE_A.id)?.siteId).toBe(SITE_B.id);
    expect(pickRunnerUp(result, SITE_B.id)?.siteId).toBe(SITE_A.id);
  });
  it("is null with a single site", () => {
    const { result } = setup();
    const single = { ranking: [SITE_A.id], sites: result.sites.slice(0, 1) };
    expect(pickRunnerUp(single, SITE_A.id)).toBeNull();
  });
  it("falls back to unranked sites by rank", () => {
    const { result } = setup();
    expect(
      pickRunnerUp({ ranking: [SITE_A.id], sites: result.sites }, SITE_A.id)
        ?.siteId,
    ).toBe(SITE_B.id);
  });
});

describe("risk derivation", () => {
  const site = (
    overrides: Partial<Parameters<typeof deriveRisks>[0]["site"]> = {},
  ) => ({
    siteId: "s1",
    demandSource: "jev" as const,
    monthlyServedCustomers: { mean: 3000, low: 2900, median: 3000, high: 3100 },
    monthlyContributionUsd: { mean: 5000, low: 4500, median: 5000, high: 5500 },
    weekdayMeanWaitMin: { mean: 2, low: 1, median: 2, high: 3 },
    tiedWith: [],
    ...overrides,
  });
  const result = {
    requestedDemandSource: "jev" as const,
    fallbackReason: null,
  };

  it("has no risks for a tight, profitable, Jev-backed site", () => {
    expect(deriveRisks({ site: site(), result })).toEqual([]);
  });
  it("flags a negative low contribution, and a negative mean more strongly", () => {
    const low = deriveRisks({
      site: site({
        monthlyContributionUsd: {
          mean: 500,
          low: -200,
          median: 500,
          high: 900,
        },
      }),
      result,
    });
    expect(low[0]).toContain("as low as -$200");
    const mean = deriveRisks({
      site: site({
        monthlyContributionUsd: {
          mean: -100,
          low: -300,
          median: -100,
          high: 50,
        },
      }),
      result,
    });
    expect(mean[0]).toContain("negative on average (-$100");
  });
  it("flags the Huff fallback with the reason Jev was not used", () => {
    const risks = deriveRisks({
      site: site({ demandSource: "huff" }),
      result: { requestedDemandSource: "jev", fallbackReason: "Jev timed out" },
    });
    expect(risks).toHaveLength(1);
    expect(risks[0]).toContain("Huff gravity fallback");
    expect(risks[0]).toContain("(Jev timed out)");
  });
  it("flags wide customer and contribution ranges", () => {
    const risks = deriveRisks({
      site: site({
        monthlyServedCustomers: {
          mean: 2000,
          low: 1000,
          median: 2000,
          high: 3000,
        },
        monthlyContributionUsd: {
          mean: 2000,
          low: 100,
          median: 2000,
          high: 4000,
        },
      }),
      result,
    });
    expect(risks.some((r) => r.includes("1,000–3,000"))).toBe(true);
    expect(risks.some((r) => r.includes("$100–$4,000"))).toBe(true);
  });
  it("flags long weekday waits by mean or by the high end", () => {
    const byMean = deriveRisks({
      site: site({
        weekdayMeanWaitMin: { mean: 9, low: 6, median: 9, high: 12 },
      }),
      result,
    });
    expect(byMean[0]).toContain("9.0 min on average");
    const byHigh = deriveRisks({
      site: site({
        weekdayMeanWaitMin: { mean: 4, low: 1, median: 4, high: 15 },
      }),
      result,
    });
    expect(byHigh[0]).toContain("up to 15.0 min");
  });
  it("reports the plan's budget status", () => {
    const plan = (status: GroundedLocationPlan["status"], extra = {}) =>
      ({
        status,
        tiedSiteIds: [],
        plan: { recommendedSiteId: null },
        ...extra,
      }) as unknown as GroundedLocationPlan;
    expect(
      deriveRisks({
        site: site(),
        result,
        plan: plan("no_site_meets_budget"),
      })[0],
    ).toContain("budget ceiling");
    expect(
      deriveRisks({ site: site(), result, plan: plan("budget_unknown") })[0],
    ).toContain("budget is unknown");
    expect(
      deriveRisks({
        site: site(),
        result,
        plan: plan("tie", { tiedSiteIds: ["s1", "s2"] }),
        addresses: { s2: "200 Elm St" },
      })[0],
    ).toContain("tied with 200 Elm St");
    expect(
      deriveRisks({
        site: site(),
        result,
        plan: plan("recommended", { plan: { recommendedSiteId: "s2" } }),
        addresses: { s2: "200 Elm St" },
      })[0],
    ).toContain("budget check recommends (200 Elm St)");
    expect(
      deriveRisks({
        site: site(),
        result,
        plan: plan("recommended", { plan: { recommendedSiteId: "s1" } }),
      }),
    ).toEqual([]);
  });
  it("uses the comparison's ties when no plan is loaded", () => {
    expect(
      deriveRisks({
        site: site({ tiedWith: ["s2"] }),
        result,
        addresses: { s2: "200 Elm St" },
      })[0],
    ).toContain("overlaps heavily with 200 Elm St");
  });
  it("caps the list at 8", () => {
    const risks = deriveRisks({
      site: site({
        demandSource: "huff",
        monthlyServedCustomers: {
          mean: 2000,
          low: 1000,
          median: 2000,
          high: 3000,
        },
        monthlyContributionUsd: {
          mean: 100,
          low: -900,
          median: 100,
          high: 900,
        },
        weekdayMeanWaitMin: { mean: 12, low: 6, median: 12, high: 20 },
      }),
      result,
      plan: { status: "budget_unknown" } as GroundedLocationPlan,
    });
    expect(risks.length).toBeGreaterThan(4);
    expect(risks.length).toBeLessThanOrEqual(8);
  });
});

describe("next steps", () => {
  it("uses the plan's next steps without citations", () => {
    const { input } = setup();
    const plan = buildLocationPlan(input);
    const steps = deriveNextSteps(plan);
    expect(steps).toHaveLength(plan.plan.nextSteps.length);
    expect(steps.every((s) => !s.includes("[comparison:"))).toBe(true);
    expect(steps[0]).toMatch(/^Before signing/);
  });
  it("falls back to defaults that mention tweaked rent, hours and staff", () => {
    expect(deriveNextSteps(null)).toEqual(defaultNextSteps());
    const steps = deriveNextSteps(undefined, {
      monthlyRentUsd: 4200,
      hours: { openMinute: 420, closeMinute: 1140 },
      staff: 3,
    });
    expect(steps[0]).toMatch(/^Tour the unit/);
    expect(steps[1]).toContain("$4,200 a month");
    expect(steps[2]).toContain("7:00 AM–7:00 PM");
    expect(steps[2]).toContain("with 3 on the clock");
  });
});

describe("buildFinalPlanSummary", () => {
  it("builds a schema-valid summary for the chosen site with its runner-up", () => {
    const { result } = setup();
    const summary = build(result);
    expect(FinalPlanSummarySchema.parse(summary)).toEqual(summary);
    expect(summary).toMatchObject({
      projectId: "p1",
      comparisonId: "comparison-a",
      chosenSiteId: SITE_A.id,
      chosenAddress: "100 Main St, Unit 1",
      rationale: "Best morning traffic and the lowest risk.",
      finalizedAt: "2026-11-15T14:30:00.000Z",
      demandSource: "jev",
      metrics: {
        monthlyContributionUsd: { mean: 1500, low: 1000, high: 2000 },
        monthlyServedCustomers: { mean: 3000, low: 2800, high: 3200 },
        weekdayMeanWaitMin: { mean: 2.5, low: 1, high: 4 },
      },
      runnerUp: {
        siteId: SITE_B.id,
        address: "200 Elm St, Unit 3",
        monthlyContributionUsd: { mean: 300, low: 200, high: 400 },
      },
    });
    expect(summary.tweaks).toBeUndefined();
    // Contribution 1,000–2,000 is a wide range; nothing else is risky.
    expect(summary.risks).toHaveLength(1);
    expect(summary.risks[0]).toContain("$1,000–$2,000");
    expect(summary.nextSteps).toEqual(defaultNextSteps());
  });
  it("picks the other ranked site as runner-up when the founder chose #2", () => {
    const { result } = setup();
    const summary = build(result, { chosenSiteId: SITE_B.id });
    expect(summary.chosenAddress).toBe("200 Elm St, Unit 3");
    expect(summary.runnerUp?.siteId).toBe(SITE_A.id);
  });
  it("keeps only the chosen site's non-empty tweaks", () => {
    const { result } = setup();
    const tweaks = {
      [SITE_A.id]: { priceUsd: 7, staff: 3 },
      [SITE_B.id]: { monthlyRentUsd: 1000 },
    };
    expect(build(result, { tweaks }).tweaks).toEqual({ priceUsd: 7, staff: 3 });
    expect(
      build(result, { tweaks: { [SITE_A.id]: {} } }).tweaks,
    ).toBeUndefined();
  });
  it("uses the real grounded plan for next steps and the site's own demand source", () => {
    const { input } = setup();
    const plan = buildLocationPlan(input);
    const result = input.comparison.evaluation.result;
    result.sites[0].demandSource = "huff";
    const summary = build(result, { plan });
    expect(summary.demandSource).toBe("huff");
    expect(summary.nextSteps).toEqual(deriveNextSteps(plan));
    expect(summary.risks.some((r) => r.includes("Huff"))).toBe(true);
  });
  it("falls back for blank rationale and missing addresses, and clips long text", () => {
    const { result } = setup();
    const summary = build(result, { rationale: "   ", addresses: {} });
    expect(summary.rationale).toBe(DEFAULT_RATIONALE);
    expect(summary.chosenAddress).toBe("Selected location");
    expect(summary.runnerUp?.address).toBe("Runner-up location");
    const long = build(result, { rationale: "x".repeat(3000) });
    expect(long.rationale).toHaveLength(2000);
  });
  it("has a null runner-up for a single-site comparison", () => {
    const { result } = setup();
    const single = {
      ...result,
      ranking: [SITE_A.id],
      sites: result.sites.slice(0, 1),
    };
    expect(build(single).runnerUp).toBeNull();
  });
  it("throws when the chosen site is not in the comparison", () => {
    const { result } = setup();
    expect(() => build(result, { chosenSiteId: "nope" })).toThrow(/nope/);
  });
});

describe("fetchGroundedPlan", () => {
  it("builds the scoped plan URL", () => {
    expect(groundedPlanUrl("cmp 1", "p1")).toBe(
      "/api/comparisons/cmp%201/plan?projectId=p1",
    );
    expect(groundedPlanUrl("c", "p", "inv")).toBe(
      "/api/comparisons/c/plan?projectId=p&investigationId=inv",
    );
  });
  it("returns a parsed plan on success", async () => {
    const { input } = setup();
    const plan = buildLocationPlan(input);
    const fetchImpl = vi.fn(async () => Response.json(plan));
    const controller = new AbortController();
    await expect(
      fetchGroundedPlan("comparison-a", {
        projectId: "p1",
        signal: controller.signal,
        fetchImpl,
      }),
    ).resolves.toEqual(plan);
    expect(fetchImpl).toHaveBeenCalledWith(
      "/api/comparisons/comparison-a/plan?projectId=p1",
      { signal: controller.signal, cache: "no-store" },
    );
  });
  it("returns null on HTTP errors, bad bodies and thrown fetches", async () => {
    const opts = (fetchImpl: typeof fetch) => ({ projectId: "p1", fetchImpl });
    await expect(
      fetchGroundedPlan(
        "c",
        opts(async () => Response.json({ error: "x" }, { status: 404 })),
      ),
    ).resolves.toBeNull();
    await expect(
      fetchGroundedPlan(
        "c",
        opts(async () => Response.json({ marker: 1 })),
      ),
    ).resolves.toBeNull();
    await expect(
      fetchGroundedPlan(
        "c",
        opts(async () => new Response("not json")),
      ),
    ).resolves.toBeNull();
    await expect(
      fetchGroundedPlan(
        "c",
        opts(async () => {
          throw new DOMException("Aborted", "AbortError");
        }),
      ),
    ).resolves.toBeNull();
  });
});
