import { describe, expect, it } from "vitest";
import { SITE_A, SITE_B } from "@/lib/demand/fixtures";
import { buildLocationPlan, resolvePlanReferences } from "./plan";
import { fixture, sweep } from "./__fixtures__/plan";
import { createComparisonPlanHandler } from "@/app/api/comparisons/plan-handler";
import { GroundedLocationPlanSchema } from "@/lib/contracts/plan";

describe("deterministic grounded location plans", () => {
  it("serializes the real builder through the read-only HTTP handler without a provider", async () => {
    const input = fixture();
    const handler = createComparisonPlanHandler({
      store: { load: async () => input.comparison },
      profiles: { load: async () => input.profile },
      build: buildLocationPlan,
    });
    const response = await handler(
      new Request(
        "http://localhost/api/comparisons/comparison-a/plan?projectId=p1",
      ),
      "comparison-a",
    );
    expect(response.status).toBe(200);
    const plan = GroundedLocationPlanSchema.parse(await response.json());
    expect(plan.plan.recommendedSiteId).toBe(SITE_A.id);
    expect(plan.narrative).toBeNull();
  });
  it("renders a clear feasible winner and runner-up with cited ranges, not mean forecasts", () => {
    const input = fixture();
    const plan = buildLocationPlan(input);
    expect(plan.status).toBe("recommended");
    expect(plan.plan.recommendedSiteId).toBe(SITE_A.id);
    expect(plan.runnerUpSiteId).toBe(SITE_B.id);
    expect(plan.why[0].facts[0].range).toEqual({ low: 1000, high: 2000 });
    expect(
      plan.facts.every(
        (fact) =>
          "comparisonId" in fact.reference &&
          fact.reference.comparisonId === input.comparison.id,
      ),
    ).toBe(true);
    expect(plan.facts.every((fact) => !Object.hasOwn(fact.range, "mean"))).toBe(
      true,
    );
    expect(buildLocationPlan(input)).toEqual(plan);
  });
  it("does not present an overlapping tie as a decisive recommendation", () => {
    const input = fixture();
    input.comparison.evaluation.result.sites[0].tiedWith = [SITE_B.id];
    const plan = buildLocationPlan(input);
    expect(plan.status).toBe("tie");
    expect(plan.plan.recommendedSiteId).toBeNull();
    expect(plan.tiedSiteIds).toEqual([SITE_A.id, SITE_B.id]);
  });
  it("declines every site over the rent budget even when contribution ranking is positive", () => {
    const input = fixture();
    input.profile.economics.monthlyRentCeilingCents.value = 1;
    const plan = buildLocationPlan(input);
    expect(plan.status).toBe("no_site_meets_budget");
    expect(plan.plan.recommendedSiteId).toBeNull();
    expect(
      plan.findings.filter((f) => f.code === "BUDGET_CONSTRAINT"),
    ).toHaveLength(2);
  });
  it("selects a lower-ranked feasible site rather than an over-budget winner", () => {
    const input = fixture();
    const a = input.comparison.evaluation.request.sites[0].config.lease;
    const b = input.comparison.evaluation.request.sites[1].config.lease;
    a.askingRentUsdPerSfYear = 1000;
    b.askingRentUsdPerSfYear = 1;
    input.profile.economics.monthlyRentCeilingCents.value = 1_000_000;
    const plan = buildLocationPlan(input);
    expect(plan.plan.recommendedSiteId).toBe(SITE_B.id);
    expect(
      plan.firstNinetyDays[0].references.every((ref) =>
        ref.metric.startsWith(`sites.${SITE_B.id}.`),
      ),
    ).toBe(true);
    expect(
      plan.firstNinetyDays[1].references.every((ref) =>
        ref.metric.startsWith(`sites.${SITE_B.id}.`),
      ),
    ).toBe(true);
  });
  it("retains unknown budgets and never infers affordability from missing ceilings", () => {
    const input = fixture();
    for (const key of [
      "monthlyRentCeilingCents",
      "startupBudgetCents",
      "buildoutBudgetCents",
      "monthlyOperatingBudgetCents",
    ] as const) {
      input.profile.economics[key].value = null;
      input.profile.economics[key].unknownReason =
        "Founder has not supplied a budget";
    }
    const plan = buildLocationPlan(input);
    expect(plan.status).toBe("budget_unknown");
    expect(plan.plan.recommendedSiteId).toBeNull();
  });
  it("lists every saved default and honest related sensitivity or not-tested result", () => {
    const input = fixture();
    input.comparison.evaluation.sensitivity = [sweep];
    const plan = buildLocationPlan(input);
    for (const [path, assumption] of Object.entries(
      input.comparison.evaluation.assembly!.assumptions,
    )) {
      expect(plan.assumptions.find((a) => a.path === path)?.origin).toBe(
        assumption.origin,
      );
    }
    expect(
      plan.assumptions.find((a) => a.path === "profile.averageTicketCents")
        ?.sensitivity.status,
    ).toBe("tested");
    expect(
      plan.assumptions.find((a) => a.path === "demographics.children")
        ?.sensitivity.status,
    ).toBe("not_tested");
    expect(plan.sensitivity[0].flipBracket?.range).toEqual({
      low: 0.8,
      high: 1.2,
    });
    expect(plan.sensitivity[0].conclusion).toContain(
      "not an exact interpolated threshold",
    );
    expect(plan.findings.map((f) => f.code)).toContain("VEHICLES_NOT_PEOPLE");
  });

  it("discloses raw qualitative defaults and their untested status", () => {
    const input = fixture();
    delete input.comparison.evaluation.assembly;
    const plan = buildLocationPlan(input);
    expect(
      plan.assumptions.find(
        (a) => a.path === "request.sites.0.config.lease.tripleNet",
      ),
    ).toMatchObject({
      origin: "default",
      qualitativeValue: false,
      sensitivity: { status: "not_tested" },
    });
    expect(
      plan.assumptions.find((a) => a.path === "request.priceTier"),
    ).toMatchObject({
      origin: "default",
      qualitativeValue: "mid",
      sensitivity: { status: "not_tested" },
    });
  });
  it("carries verified investigation findings and budget caveats", () => {
    const plan = buildLocationPlan({
      ...fixture(),
      investigation: { findings: ["Parking evidence is missing."] },
    });
    expect(
      plan.findings.some((f) => f.message === "Parking evidence is missing."),
    ).toBe(true);
    expect(plan.findings.some((f) => f.code === "BUDGET_LIMITATION")).toBe(
      true,
    );
  });
  it("states Huff fallback and does not claim an independent check of itself", () => {
    const input = fixture();
    input.comparison.evaluation.result.requestedDemandSource = "jev";
    input.comparison.evaluation.result.fallbackReason =
      "Missing saved behavior table";
    const plan = buildLocationPlan(input);
    expect(plan.demand).toMatchObject({
      requested: "jev",
      actual: "huff",
      huffAgreement: "not_independent",
      fallbackReason: "Missing saved behavior table",
    });
  });
  it("runs an offline Huff check when the saved primary demand source is Jev", () => {
    const input = fixture();
    input.comparison.evaluation.result.demandSource = "jev";
    input.comparison.evaluation.result.requestedDemandSource = "jev";
    expect(["agreed", "disagreed"]).toContain(
      buildLocationPlan(input).demand.huffAgreement,
    );
  });
  it.each(["project", "profile", "version", "run"])(
    "rejects cross-scope %s artifacts",
    (kind) => {
      const input = fixture();
      if (kind === "project")
        input.comparison.evaluation.result.projectId = "other";
      if (kind === "profile") input.profile.id = "other";
      if (kind === "version") input.profile.version++;
      if (kind === "run") input.comparison.runs[0].projectId = "other";
      expect(() => buildLocationPlan(input)).toThrow(/scope|snapshot/);
    },
  );
  it("resolves registered references and rejects unknown metrics, runs and foreign comparisons", () => {
    const plan = buildLocationPlan(fixture());
    const reference = plan.facts[0].reference;
    expect(resolvePlanReferences(plan.facts, [reference])[0]).toEqual(
      plan.facts[0],
    );
    for (const bad of [
      { comparisonId: "foreign", metric: "monthlyContributionUsd" },
      { comparisonId: "comparison-a", metric: "__proto__" },
      { runId: "unknown", metric: "served" },
    ]) {
      expect(() => resolvePlanReferences(plan.facts, [bad])).toThrow(
        /Unresolved/,
      );
    }
    for (const check of plan.firstNinetyDays)
      expect(() =>
        resolvePlanReferences(plan.facts, check.references),
      ).not.toThrow();
  });
});
