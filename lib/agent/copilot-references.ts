import { z } from "zod";
import { isDeepStrictEqual } from "node:util";
import {
  CopilotReadReferenceSchema,
  CopilotComparisonBindingSchema,
} from "@/lib/contracts/copilot-read-tools";
import { PriceAcceptanceShiftReferenceSchema } from "@/lib/contracts/copilot-tools";
import { ScenarioSchema, type Scenario } from "@/lib/contracts/scenario";
import {
  EvaluationRequestSchema,
  EvaluationResultSchema,
} from "@/lib/contracts/evaluation";
import type { CopilotStoredComparison } from "./copilot-read-tools";
import { acceptanceAt } from "@/lib/evaluation/evaluate";
import { flattenOverrides } from "@/lib/scenario/model";

export const CopilotReferenceSchema = z.union([
  CopilotReadReferenceSchema,
  PriceAcceptanceShiftReferenceSchema,
]);
export type CopilotReference = z.infer<typeof CopilotReferenceSchema>;

/** Only resolve references issued by a verified tool, against caller-loaded scoped artifacts.
 * This is a display resolver, not another model tool: numeric values never become model prose.
 */
export function resolveCopilotReference(input: {
  reference: unknown;
  issuedReferences: readonly unknown[];
  projectId: string;
  scenarios: readonly Scenario[];
  comparisons: readonly CopilotStoredComparison[];
}) {
  const reference = CopilotReferenceSchema.parse(input.reference);
  const key = JSON.stringify(reference);
  if (
    !input.issuedReferences.some((raw) => {
      const parsed = CopilotReferenceSchema.safeParse(raw);
      return parsed.success && JSON.stringify(parsed.data) === key;
    })
  )
    throw new Error("Reference was not issued by a verified tool");
  const fail = (): never => {
    throw new Error("Reference cannot be resolved in this context");
  };
  const scenarioFor = (id: string) => {
    const found = input.scenarios.filter(
      (s) => s.id === id && s.projectId === input.projectId,
    );
    return found.length === 1 ? ScenarioSchema.parse(found[0]) : fail();
  };
  const comparisonFor = (id: string) => {
    const matches = input.comparisons.filter((c) => c.id === id);
    if (matches.length !== 1) return fail();
    const found = matches[0];
    const request = EvaluationRequestSchema.parse(found.evaluation.request);
    const result = EvaluationResultSchema.parse(found.evaluation.result);
    if (
      found.comparison.id !== id ||
      request.projectId !== input.projectId ||
      result.projectId !== input.projectId ||
      found.comparison.projectId !== input.projectId ||
      request.profileId !== result.profileId ||
      found.comparison.profileId !== request.profileId ||
      request.profileVersion !== result.profileVersion
    )
      return fail();
    const binding =
      found.copilotBinding === undefined
        ? undefined
        : CopilotComparisonBindingSchema.parse(found.copilotBinding);
    if (
      binding &&
      (binding.projectId !== input.projectId ||
        binding.comparisonId !== found.id)
    )
      return fail();
    const scenarioId =
      binding?.scenarioId ?? found.evaluation.assembly?.scenario?.id;
    if (!scenarioId) return fail();
    const scenario = scenarioFor(scenarioId);
    const snapshot = found.evaluation.assembly!.scenario!;
    if (
      snapshot.layoutId !== scenario.layoutId ||
      !isDeepStrictEqual(snapshot.overrides, scenario.overrides) ||
      scenario.profileVersion !== request.profileVersion ||
      scenario.siteIds.length !== request.sites.length ||
      !request.sites.every((s) => scenario.siteIds.includes(s.siteId))
    )
      return fail();
    return found;
  };
  const metricFor = (
    id: string,
    siteId: string,
    metric: z.infer<
      typeof import("@/lib/contracts/copilot-read-tools").ComparisonMetricSchema
    >,
  ) => {
    const record = comparisonFor(id);
    const site = record.evaluation.result.sites.find(
      (s) => s.siteId === siteId,
    );
    if (!site) return fail();
    return site[metric];
  };
  switch (reference.kind) {
    case "scenario_value": {
      const scenario = scenarioFor(reference.scenarioId);
      if (reference.path === "siteIds")
        return {
          reference,
          value: scenario.siteIds,
          origin: "default" as const,
        };
      const wrappers = flattenOverrides(scenario.overrides);
      const entry = Object.entries(wrappers).find(
        ([path]) => `overrides.${path}` === reference.path,
      )?.[1];
      if (!entry) return fail();
      return {
        reference,
        value: entry.value,
        unit: entry.unit,
        origin: entry.origin,
        evidenceIds: entry.evidenceIds,
      };
    }
    case "comparison_metric":
      return {
        reference,
        value: metricFor(
          reference.comparisonId,
          reference.siteId,
          reference.metric,
        )[reference.statistic],
        origin: "default" as const,
      };
    case "comparison_delta": {
      const a = comparisonFor(reference.comparisonIdA),
        b = comparisonFor(reference.comparisonIdB);
      if (
        a.evaluation.request.profileId !== b.evaluation.request.profileId ||
        a.evaluation.request.profileVersion !==
          b.evaluation.request.profileVersion
      )
        return fail();
      const av = metricFor(a.id, reference.siteId, reference.metric),
        bv = metricFor(b.id, reference.siteId, reference.metric);
      const value =
        reference.statistic === "low"
          ? bv.low - av.high
          : reference.statistic === "high"
            ? bv.high - av.low
            : bv[reference.statistic] - av[reference.statistic];
      return {
        reference,
        value,
        origin: "default" as const,
        limitation: "Unpaired interval difference, not paired-seed confidence",
      };
    }
    case "hour_metric": {
      const matches = input.comparisons.filter((c) =>
        c.runs.some((r) => r.id === reference.runId),
      );
      if (matches.length !== 1) return fail();
      const record = comparisonFor(matches[0].id);
      const run = record.runs.find((r) => r.id === reference.runId)!;
      if (
        run.projectId !== input.projectId ||
        run.profileId !== record.evaluation.request.profileId
      )
        return fail();
      const representative = record.evaluation.result.sites.find(
        (s) => s.siteId === run.siteId,
      )?.representative[run.dayType];
      const hours =
        representative?.runId === run.id
          ? representative.hourly.filter((h) => h.hour === reference.hour)
          : [];
      if (hours.length !== 1 || hours[0][reference.metric] === null)
        return fail();
      return {
        reference,
        value: hours[0][reference.metric],
        origin: "default" as const,
        limitation: "Saved representative run only",
      };
    }
    case "candidate":
      if (reference.projectId !== input.projectId) return fail();
      scenarioFor(reference.scenarioId);
      return {
        reference,
        value: reference.siteId,
        evidenceIds: reference.evidenceIds,
      };
    case "price_acceptance_shift": {
      const record = comparisonFor(reference.comparisonId);
      const scenario = scenarioFor(reference.scenarioId);
      if (
        scenario.parentId !==
          (record.copilotBinding?.scenarioId ??
            record.evaluation.assembly?.scenario?.id) ||
        scenario.profileVersion !== record.evaluation.request.profileVersion
      )
        return fail();
      const price = scenario.overrides.averageTicketCents?.value;
      const site = record.evaluation.request.sites.find(
        (s) => s.siteId === reference.siteId,
      );
      if (
        price === undefined ||
        price === null ||
        !site?.behaviorTable?.personas.length
      )
        return fail();
      const rows = site.behaviorTable.personas.map((persona) => ({
        personaId: persona.personaId,
        before: acceptanceAt(
          persona.priceAcceptance,
          site.config.prices.avgTicketUsd,
        ),
        after: acceptanceAt(persona.priceAcceptance, price / 100),
      }));
      if (rows.some((row) => row.before === null || row.after === null))
        return fail();
      return {
        reference,
        value: rows.map((row) => ({ ...row, shift: row.after! - row.before! })),
        origin: "default" as const,
        limitation:
          "Cached persona acceptance interpolation, not a new panel response or a sales forecast",
      };
    }
  }
}
