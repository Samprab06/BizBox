import { createHash } from "node:crypto";
import { BusinessProfileSchema, type BusinessProfile } from "@/lib/contracts";
import {
  GroundedLocationPlanSchema,
  PlanReferenceSchema,
  type GroundedLocationPlan,
  type PlanFact,
  type PlanReference,
} from "@/lib/contracts/plan";
import type { SensitivityAssumption } from "@/lib/contracts/evaluation";
import type { StoredComparison } from "@/lib/evaluation/store";
import { applyConfigOverrides, evaluateSites } from "@/lib/evaluation/evaluate";

export type LocationPlanInput = {
  projectId: string;
  profile: BusinessProfile;
  comparison: StoredComparison;
  investigation?: { findings: string[] };
};

/** References are selected from a server-owned registry, never evaluated as object paths. */
export function referenceKey(ref: PlanReference): string {
  if ("comparisonId" in ref)
    return JSON.stringify(["comparison", ref.comparisonId, ref.metric]);
  if ("runId" in ref) return JSON.stringify(["run", ref.runId, ref.metric]);
  return JSON.stringify(["evidence", ref.evidenceId, ref.metric]);
}

export function resolvePlanReferences(
  facts: PlanFact[],
  references: PlanReference[],
): PlanFact[] {
  const registry = new Map(
    facts.map((fact) => [referenceKey(fact.reference), fact]),
  );
  return references.map((ref) => {
    const fact = registry.get(referenceKey(PlanReferenceSchema.parse(ref)));
    if (!fact) throw new Error("Unresolved or out-of-scope plan reference");
    return fact;
  });
}

const sensitivityFor = (path: string): SensitivityAssumption | null => {
  if (/monthlyBaseRent|askingRent|rentMultiplier/.test(path)) return "rent";
  if (/averageTicket|avgTicket|ticketMultiplier/.test(path))
    return "ticket_size";
  if (/marketShare|market_share/.test(path)) return "market_share_scale";
  if (/visitFrequency|visit_frequency|visitsPer/.test(path))
    return "visit_frequency";
  if (/priceUsd/.test(path)) return "price";
  return null;
};

/** Saved-data renderer. No model, network, filesystem, new panel polling or forecasts. */
export function buildLocationPlan(
  input: LocationPlanInput,
): GroundedLocationPlan {
  const profile = BusinessProfileSchema.parse(input.profile);
  const stored = input.comparison;
  const { request, result, assembly, sensitivity } = stored.evaluation;
  if (
    profile.projectId !== input.projectId ||
    request.projectId !== input.projectId ||
    stored.comparison.projectId !== input.projectId ||
    result.projectId !== input.projectId ||
    profile.id !== request.profileId ||
    profile.id !== result.profileId ||
    profile.id !== stored.comparison.profileId ||
    profile.version !== request.profileVersion ||
    profile.version !== result.profileVersion ||
    stored.id !== stored.comparison.id ||
    stored.runs.some(
      (run) =>
        run.projectId !== input.projectId || run.profileId !== profile.id,
    )
  ) {
    throw new Error("Plan scope or profile snapshot mismatch");
  }
  const ids = new Set(request.sites.map((site) => site.siteId));
  if (
    !result.ranking.length ||
    new Set(result.ranking).size !== ids.size ||
    result.ranking.some((id) => !ids.has(id)) ||
    result.sites.length !== ids.size ||
    new Set(result.sites.map((site) => site.siteId)).size !== ids.size ||
    result.sites.some((site) => !ids.has(site.siteId))
  ) {
    throw new Error("Incomplete comparison cannot ground a plan");
  }
  const facts: PlanFact[] = [];
  const sweepConclusion = (topChanges: boolean) =>
    topChanges
      ? "The baseline winner does not remain top throughout the cited tested range. Use the adjacent tested flip bracket when available, not an exact interpolated threshold."
      : "The baseline winner stays top across the cited tested range only; behavior outside that range is not established.";
  const ref = (metric: string): PlanReference => ({
    comparisonId: stored.id,
    metric,
  });
  const fact = (
    metric: string,
    low: number,
    high = low,
    unit = "scenario",
    origins: PlanFact["origins"] = ["default"],
    evidenceIds: string[] = [],
    kind: PlanFact["kind"] = "input",
  ): PlanFact => {
    const value: PlanFact = {
      reference: ref(metric),
      range: { low, high },
      unit,
      origins,
      evidenceIds,
      kind,
    };
    facts.push(value);
    return value;
  };
  const findings: GroundedLocationPlan["findings"] = (
    assembly?.findings ?? []
  ).map((finding, index) => ({
    ...finding,
    reference: ref(`assembly.findings.${index}`),
  }));
  for (const [index, message] of (
    input.investigation?.findings ?? []
  ).entries()) {
    findings.push({
      code: "INVESTIGATION_FINDING",
      message,
      reference: ref(`investigation.findings.${index}`),
    });
  }
  const assumptions: GroundedLocationPlan["assumptions"] = [];
  const addAssumption = (
    path: string,
    value: number | null,
    origin: PlanFact["origins"][number],
    evidenceIds: string[],
    unit = "scenario",
    qualitativeValue: string | boolean | null = null,
  ) => {
    const parameter = sensitivityFor(path);
    const tested = parameter
      ? sensitivity.find((sweep) => sweep.assumption === parameter)
      : undefined;
    assumptions.push({
      path,
      reference: ref(`assumptions.${path}`),
      origin,
      qualitativeValue,
      fact:
        value === null
          ? null
          : fact(
              `assumptions.${path}`,
              value,
              value,
              unit,
              [origin],
              evidenceIds,
            ),
      sensitivity: {
        status: tested ? "tested" : "not_tested",
        conclusion: tested
          ? `Related ${parameter} sweep only: ${sweepConclusion(tested.topChanges)} This does not independently test every input contributing to that parameter.`
          : "Not tested. Validate this assumption before relying on the recommendation.",
        references: tested ? [ref(`sensitivity.${parameter}`)] : [],
      },
    });
  };
  // Retain every assembly assumption, including partly-default demographics.
  for (const [path, assumption] of Object.entries(
    assembly?.assumptions ?? {},
  )) {
    addAssumption(
      path,
      assumption.value,
      assumption.origin,
      assumption.evidenceIds,
    );
  }
  // Preserve explicitly unknown profile values as well as defaults/flags/price tier.
  const walkProfile = (node: unknown, path: string) => {
    if (!node || typeof node !== "object") return;
    const object = node as Record<string, unknown>;
    if ("origin" in object && "value" in object && "evidenceIds" in object) {
      const origin = object.origin as PlanFact["origins"][number];
      addAssumption(
        path,
        typeof object.value === "number" ? object.value : null,
        origin,
        object.evidenceIds as string[],
        String(object.unit),
        typeof object.value === "boolean" || typeof object.value === "string"
          ? object.value
          : null,
      );
      if (object.value === null)
        findings.push({
          code: "UNKNOWN_PROFILE_INPUT",
          message: `${path}: ${object.unknownReason ?? "Unknown input"}`,
          reference: ref(`profile.${path}`),
        });
      return;
    }
    for (const [key, child] of Object.entries(object))
      walkProfile(child, path ? `${path}.${key}` : key);
  };
  walkProfile(profile, "profile");
  // Raw evaluation requests can bypass assembly. Conservatively label untracked
  // inputs default, rather than silently claiming they are source observations.
  const walkRequest = (
    node: unknown,
    path: string,
    inherited: PlanFact["origins"][number] = "default",
  ) => {
    if (typeof node === "number") {
      const sitePath = /^sites\.(\d+)\.(.*)$/.exec(path);
      const provenancePath = sitePath
        ? `sites.${request.sites[Number(sitePath[1])].siteId}.${sitePath[2]}`
        : path;
      const source = assembly?.assumptions[provenancePath];
      if (!source) addAssumption(`request.${path}`, node, inherited, []);
      return;
    }
    if (typeof node === "string" || typeof node === "boolean") {
      addAssumption(
        `request.${path}`,
        null,
        inherited,
        [],
        "qualitative",
        node,
      );
      return;
    }
    if (!node || typeof node !== "object") return;
    const object = node as Record<string, unknown>;
    const origin = ["costar", "public", "founder", "default"].includes(
      String(object.origin),
    )
      ? (object.origin as PlanFact["origins"][number])
      : inherited;
    for (const [key, child] of Object.entries(object)) {
      if (
        [
          "profileVersion",
          "id",
          "siteId",
          "profileId",
          "projectId",
          "origin",
          "modelVersion",
          "behaviorTableId",
        ].includes(key)
      )
        continue;
      walkRequest(child, path ? `${path}.${key}` : key, origin);
    }
  };
  walkRequest(request, "");
  if (!assembly)
    findings.push({
      code: "ASSEMBLY_PROVENANCE_UNAVAILABLE",
      message:
        "No assembly provenance was saved. Untracked inputs are conservatively labeled default, not observed data.",
      reference: ref("assembly"),
    });

  const origins = [...new Set(assumptions.map((a) => a.origin))];
  const metricNames = [
    "monthlyContributionUsd",
    "monthlyContributionAfterBuildoutUsd",
    "monthlyRevenueUsd",
    "monthlyServedCustomers",
    "weekdayMeanWaitMin",
    "weekdayAbandonmentRate",
    "weekdayUtilization",
  ] as const;
  const why = result.ranking.map((siteId) => {
    const site = result.sites.find((site) => site.siteId === siteId)!;
    if (site.excludedPersonaIds.length)
      findings.push({
        code: "EXCLUDED_PERSONAS",
        siteId,
        message: `Personas excluded from this site's demand calculation: ${site.excludedPersonaIds.join(", ")}.`,
        reference: ref(`sites.${siteId}.excludedPersonaIds`),
      });
    return {
      siteId,
      explanation: site.tiedWith.length
        ? "Scenario intervals overlap; the ranking is not a meaningful separation."
        : "Compare operating contribution with after-buildout contribution and service-risk intervals; these are scenarios, not sales forecasts.",
      facts: metricNames.map((metric) =>
        fact(
          `sites.${siteId}.${metric}`,
          site[metric].low,
          site[metric].high,
          metric.includes("Usd")
            ? "USD/month"
            : metric.includes("Wait")
              ? "minutes"
              : metric.includes("Customers")
                ? "customers/month"
                : "fraction",
          origins.length ? origins : ["default"],
          [],
          "scenario_interval",
        ),
      ),
    };
  });

  const budgets = [
    profile.economics.monthlyRentCeilingCents,
    profile.economics.buildoutBudgetCents,
    profile.economics.startupBudgetCents,
    profile.economics.monthlyOperatingBudgetCents,
  ];
  const hasBudget = budgets.some((budget) => budget.value !== null);
  const eligible: string[] = [];
  const leaseTargets: PlanFact[] = [];
  const staffingAndStations: PlanFact[] = [];
  const buildoutBudget: PlanFact[] = [];
  const configFact = (
    siteId: string,
    path: string,
    value: number,
    unit: string,
  ) => {
    const source = assembly?.assumptions[`sites.${siteId}.config.${path}`];
    return fact(
      `sites.${siteId}.${path}`,
      value,
      value,
      unit,
      [source?.origin ?? "default"],
      source?.evidenceIds ?? [],
    );
  };
  for (const siteId of result.ranking) {
    const site = request.sites.find((site) => site.siteId === siteId)!;
    const config = applyConfigOverrides(site.config, result.overrides);
    const rent =
      (config.lease.sf *
        (config.lease.askingRentUsdPerSfYear +
          (config.lease.tripleNet ? config.lease.opexUsdPerSfYear : 0))) /
      12;
    const labor =
      (config.staff.headcount *
        config.staff.wageUsdPerHour *
        ((config.hours.weekday.closeMin - config.hours.weekday.openMin) *
          config.calendar.weekdayDaysPerMonth +
          (config.hours.weekend.closeMin - config.hours.weekend.openMin) *
            config.calendar.weekendDaysPerMonth)) /
      60;
    const outcome = result.sites.find((site) => site.siteId === siteId)!;
    const expensesHigh =
      rent +
      labor +
      outcome.monthlyRevenueUsd.high * config.costs.cogsPctOfRevenue;
    const violations = [
      budgets[0].value !== null && rent * 100 > budgets[0].value,
      budgets[1].value !== null &&
        config.lease.buildoutUsd * 100 > budgets[1].value,
      budgets[2].value !== null &&
        config.lease.buildoutUsd * 100 > budgets[2].value,
      budgets[3].value !== null && expensesHigh * 100 > budgets[3].value,
    ];
    if (violations.some(Boolean))
      findings.push({
        code: "BUDGET_CONSTRAINT",
        siteId,
        message:
          "Does not clear all supplied scenario budget ceilings (monthly operating cost uses the upper scenario bound); do not sign on the ranking alone.",
        reference: ref(`sites.${siteId}.budget`),
      });
    else eligible.push(siteId);
    const source =
      assembly?.assumptions[`sites.${siteId}.monthlyBaseRentCents`];
    const opexSource =
      assembly?.assumptions[`sites.${siteId}.monthlyOpexCents`];
    leaseTargets.push(
      fact(
        `sites.${siteId}.monthlyLeaseUsd`,
        rent,
        rent,
        "USD/month",
        [
          ...new Set([
            source?.origin ?? "default",
            opexSource?.origin ?? "default",
          ]),
        ],
        [...(source?.evidenceIds ?? []), ...(opexSource?.evidenceIds ?? [])],
      ),
    );
    leaseTargets.push(
      fact(
        `sites.${siteId}.sizeSqft`,
        config.lease.sf,
        config.lease.sf,
        "sqft",
        [
          assembly?.assumptions[`sites.${siteId}.sizeSqft`]?.origin ??
            "default",
        ],
      ),
    );
    leaseTargets.push(
      configFact(
        siteId,
        "lease.leaseTermMonths",
        config.lease.leaseTermMonths,
        "months",
      ),
    );
    const usableStations = Math.min(
      config.stations.planned,
      Math.floor(config.stations.usableSf / config.stations.sfPerStation),
    );
    staffingAndStations.push(
      configFact(
        siteId,
        "stations.planned",
        config.stations.planned,
        "stations",
      ),
    );
    staffingAndStations.push(
      fact(
        `sites.${siteId}.usableStations`,
        usableStations,
        usableStations,
        "stations",
      ),
    );
    staffingAndStations.push(
      configFact(siteId, "staff.headcount", config.staff.headcount, "people"),
    );
    buildoutBudget.push(
      configFact(siteId, "lease.buildoutUsd", config.lease.buildoutUsd, "USD"),
    );
  }
  for (const key of [
    "monthlyRentCeilingCents",
    "buildoutBudgetCents",
    "startupBudgetCents",
  ] as const) {
    const value = profile.economics[key];
    if (value.value !== null) {
      const limit = fact(
        `profile.${key}`,
        value.value / 100,
        value.value / 100,
        key === "monthlyRentCeilingCents" ? "USD/month ceiling" : "USD ceiling",
        [value.origin],
        value.evidenceIds,
      );
      (key === "monthlyRentCeilingCents" ? leaseTargets : buildoutBudget).push(
        limit,
      );
    }
  }
  findings.push({
    code: "BUDGET_LIMITATION",
    message:
      "Budget screen covers modeled lease, labor, COGS and buildout only. Deposits, financing, contingency, permits and working capital are unverified; startup feasibility is not established.",
    reference: ref("budget"),
  });
  const preferred = hasBudget ? (eligible[0] ?? null) : null;
  const winner = result.sites.find((site) => site.siteId === preferred);
  const tiedSiteIds = preferred
    ? eligible.filter(
        (id) =>
          id === preferred ||
          winner!.tiedWith.includes(id) ||
          result.sites
            .find((site) => site.siteId === id)!
            .tiedWith.includes(preferred),
      )
    : [];
  const status: GroundedLocationPlan["status"] = !hasBudget
    ? "budget_unknown"
    : !preferred
      ? "no_site_meets_budget"
      : tiedSiteIds.length > 1
        ? "tie"
        : "recommended";
  const sweeps = sensitivity.map((sweep) => {
    const points = [...sweep.points].sort((a, b) => a.value - b.value);
    const values = points.map((point) => point.value);
    const testedRange = fact(
      `sensitivity.${sweep.assumption}`,
      Math.min(...values),
      Math.max(...values),
      sweep.unit,
      ["default"],
      [],
      "tested_interval",
    );
    let flipBracket: PlanFact | null = null;
    for (let index = 1; index < points.length; index++) {
      const before = points[index - 1],
        after = points[index];
      if (before.topSiteId !== after.topSiteId) {
        flipBracket = fact(
          `sensitivity.${sweep.assumption}.flipBracket`,
          Math.min(before.value, after.value),
          Math.max(before.value, after.value),
          sweep.unit,
          ["default"],
          [],
          "tested_interval",
        );
        break;
      }
    }
    return {
      assumption: sweep.assumption,
      conclusion: sweepConclusion(sweep.topChanges),
      topChanges: sweep.topChanges,
      testedRange,
      flipBracket,
    };
  });
  // Only a cached-input deterministic Huff evaluation; no panel/provider requests.
  const huffRanking =
    result.demandSource === "jev"
      ? evaluateSites({ ...request, demandSource: "huff" }).result.ranking
      : result.ranking;
  const demand: GroundedLocationPlan["demand"] = {
    requested: result.requestedDemandSource,
    actual: result.demandSource,
    fallbackReason: result.fallbackReason,
    huffAgreement:
      result.demandSource === "huff"
        ? "not_independent"
        : huffRanking.join() === result.ranking.join()
          ? "agreed"
          : "disagreed",
    reference: ref("demandSourceCheck"),
  };
  const recommendation =
    status === "no_site_meets_budget"
      ? "No site clears all supplied scenario budget ceilings. Revise the concept or negotiate and rerun."
      : status === "budget_unknown"
        ? "Budget is unknown. The scenario ranking is provisional and is not a lease recommendation."
        : status === "tie"
          ? "The leading feasible sites are tied; validate the cited assumptions before choosing."
          : "The highest-ranked site clearing the supplied modeled budget ceilings is conditionally recommended; validate the scenario inputs before signing.";
  const horizon = fact("validation.horizonDays", 0, 90, "days after opening", [
    "default",
  ]);
  addAssumption("validation.horizonDays", 90, "default", [], "days");
  const validationSites = new Set(
    status === "tie" ? tiedSiteIds : preferred ? [preferred] : result.ranking,
  );
  const validationScenarios = why.filter((site) =>
    validationSites.has(site.siteId),
  );
  const validationInputs = [...leaseTargets, ...buildoutBudget].filter((f) =>
    [...validationSites].some((siteId) =>
      f.reference.metric.startsWith(`sites.${siteId}.`),
    ),
  );
  const firstNinetyDays = [
    {
      check:
        "Before signing, count morning foot traffic on typical weekdays and compare it with modeled customers; collect local evidence before changing the demand assumptions.",
      references: validationScenarios.map((site) => site.facts[3].reference),
    },
    {
      check:
        "During opening, record service times, queue waits and abandonment; compare observations with the cited service-risk intervals and rerun staffing.",
      references: validationScenarios.flatMap((site) =>
        site.facts.slice(-3).map((f) => f.reference),
      ),
    },
    {
      check:
        "Through the cited opening horizon, reconcile actual lease charges, ticket mix, staffing cost and buildout invoices against the cited scenario inputs; rerun the comparison when assumptions change.",
      references: [
        horizon.reference,
        ...validationInputs.map((f) => f.reference),
      ],
    },
  ];
  const citation = `[comparison:${stored.id}]`;
  const planId = `plan-${createHash("sha256")
    .update(
      JSON.stringify({
        projectId: input.projectId,
        profile,
        evaluation: stored.evaluation,
        investigation: input.investigation,
      }),
    )
    .digest("hex")
    .slice(0, 24)}`;
  return GroundedLocationPlanSchema.parse({
    plan: {
      id: planId,
      projectId: input.projectId,
      synthetic: stored.comparison.synthetic || profile.synthetic,
      profileId: profile.id,
      comparisonId: stored.id,
      recommendedSiteId: status === "tie" ? null : preferred,
      recommendation: `${recommendation} ${citation}`,
      conditions: sweeps.map((s) => `${s.conclusion} ${citation}`),
      nextSteps: firstNinetyDays.map((check) => `${check.check} ${citation}`),
      evidenceIds: [stored.id],
      outputKind: "scenario_recommendation",
      notSalesForecast: true,
    },
    status,
    runnerUpSiteId: eligible.find((id) => id !== preferred) ?? null,
    tiedSiteIds: status === "tie" ? tiedSiteIds : [],
    why,
    leaseTargets,
    staffingAndStations,
    buildoutBudget,
    firstNinetyDays,
    assumptions,
    sensitivity: sweeps,
    findings,
    demand,
    facts,
    narrative: null,
  });
}
