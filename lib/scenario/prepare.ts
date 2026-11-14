import { BusinessProfileSchema, type BusinessProfile } from "@/lib/contracts";
import {
  EvaluationRequestSchema,
  type DemandSource,
} from "@/lib/contracts/evaluation";
import type { Scenario } from "@/lib/contracts/scenario";
import type { Layout } from "@/lib/contracts/layout";
import { applyLayoutToConfig } from "@/lib/layout";
import type {
  AssembleEvaluationInput,
  AssembledEvaluation,
} from "@/lib/evaluation/assemble";
import { ScenarioRunError } from "./run-store";

/** Immutable profile snapshot + sourced scenario wrappers -> canonical HAC-22 request. */
export function createScenarioPreparer({
  loadProfile,
  loadLayout,
  assemble,
}: {
  loadProfile: (
    projectId: string,
    version: number,
  ) => Promise<BusinessProfile | null>;
  loadLayout: (projectId: string, id: string) => Promise<Layout | null>;
  assemble: (input: AssembleEvaluationInput) => Promise<AssembledEvaluation>;
}) {
  return async (
    scenario: Scenario,
    demandSource: DemandSource,
  ): Promise<AssembledEvaluation> => {
    const snapshot = await loadProfile(
      scenario.projectId,
      scenario.profileVersion,
    );
    if (!snapshot)
      throw new ScenarioRunError("not_found", "Profile snapshot not found");
    if (
      snapshot.projectId !== scenario.projectId ||
      snapshot.version !== scenario.profileVersion
    )
      throw new ScenarioRunError(
        "invalid",
        "Profile snapshot identity mismatch",
      );
    const profile = structuredClone(snapshot),
      o = scenario.overrides;
    if (o.averageTicketCents)
      profile.economics.averageTicketCents = {
        ...o.averageTicketCents,
        unit: profile.economics.averageTicketCents.unit,
      };
    if (o.staffHeadcount)
      profile.capacity.servers = {
        ...o.staffHeadcount,
        unit: profile.capacity.servers.unit,
      };
    if (o.priceTier) profile.economics.priceTier = o.priceTier;
    const selectedLayout = scenario.layoutId
      ? await loadLayout(scenario.projectId, scenario.layoutId)
      : null;
    if (scenario.layoutId && !selectedLayout)
      throw new ScenarioRunError("not_found", "Selected layout not found");
    if (selectedLayout && !scenario.siteIds.includes(selectedLayout.siteId))
      throw new ScenarioRunError(
        "invalid",
        "Selected layout does not belong to a shortlisted site",
      );
    if (selectedLayout && selectedLayout.category !== profile.category)
      throw new ScenarioRunError(
        "invalid",
        "Selected layout category does not match the profile",
      );
    const result = await assemble({
      projectId: scenario.projectId,
      profileId: profile.id,
      profileVersion: scenario.profileVersion,
      profile: BusinessProfileSchema.parse(profile),
      candidateIds: scenario.siteIds,
      demandSource,
      ...(o.seedSet ? { seeds: o.seedSet.value.length } : {}),
    });
    if (
      result.request.projectId !== scenario.projectId ||
      result.request.profileId !== profile.id ||
      result.request.profileVersion !== scenario.profileVersion
    )
      throw new ScenarioRunError(
        "invalid",
        "Assembled profile snapshot identity mismatch",
      );
    const assumptions = { ...result.assumptions };
    const sites = result.request.sites.map((site) => {
      let config = structuredClone(site.config);
      for (const day of ["weekday", "weekend"] as const) {
        const hours = o.hours?.[day];
        if (hours) {
          config.hours[day] = {
            openMin: hours.openMinute.value!,
            closeMin: hours.closeMinute.value!,
          };
          assumptions[`${site.siteId}.config.hours.${day}.openMin`] = {
            value: hours.openMinute.value!,
            origin: hours.openMinute.origin,
            evidenceIds: hours.openMinute.evidenceIds,
          };
          assumptions[`${site.siteId}.config.hours.${day}.closeMin`] = {
            value: hours.closeMinute.value!,
            origin: hours.closeMinute.origin,
            evidenceIds: hours.closeMinute.evidenceIds,
          };
        }
      }
      // Also assign explicitly after assembly: injected/prepared adapters must retain exact overrides.
      if (o.staffHeadcount) config.staff.headcount = o.staffHeadcount.value!;
      if (o.averageTicketCents)
        config.prices.avgTicketUsd = o.averageTicketCents.value! / 100;
      if (o.plannedStations) {
        if (
          o.plannedStations.value! >
          Math.floor(config.stations.usableSf / config.stations.sfPerStation)
        )
          throw new ScenarioRunError(
            "invalid",
            "Planned stations exceed the site's modeled area capacity",
          );
        config.stations.planned = o.plannedStations.value!;
        assumptions[`${site.siteId}.config.stations.planned`] = {
          value: o.plannedStations.value!,
          origin: o.plannedStations.origin,
          evidenceIds: o.plannedStations.evidenceIds,
        };
      }
      if (selectedLayout?.siteId === site.siteId) {
        config = applyLayoutToConfig(selectedLayout, config, {
          plannedStationsOverride: o.plannedStations?.value ?? undefined,
        });
        // These are derived model capacities, not untransformed listing/scan measurements.
        const evidenceIds = [
          ...new Set([
            `layout:${selectedLayout.layoutId}`,
            ...selectedLayout.room.evidenceIds,
            ...selectedLayout.queuePath.evidenceIds,
            ...selectedLayout.policy.queueSpacingFt.evidenceIds,
          ]),
        ];
        for (const [key, value] of Object.entries({
          "stations.planned": config.stations.planned,
          "stations.usableSf": config.stations.usableSf,
          "stations.sfPerStation": config.stations.sfPerStation,
          queueCapacity: config.queueCapacity!,
        }))
          assumptions[`${site.siteId}.config.${key}`] = {
            value,
            origin: "default",
            evidenceIds,
          };
      }
      return { ...site, config };
    });
    if (o.demandMultiplier)
      assumptions["scenario.demandMultiplier"] = {
        value: o.demandMultiplier.value!,
        origin: o.demandMultiplier.origin,
        evidenceIds: o.demandMultiplier.evidenceIds,
      };
    const request = EvaluationRequestSchema.parse({
      ...result.request,
      sites,
      ...(o.priceTier
        ? {
            priceTier:
              o.priceTier.value === "budget"
                ? "low"
                : o.priceTier.value === "premium"
                  ? "high"
                  : "mid",
          }
        : {}),
      ...(o.seedSet
        ? { seeds: o.seedSet.value.length, seedSet: o.seedSet.value }
        : {}),
      overrides: {
        ...result.request.overrides,
        ...(o.demandMultiplier
          ? {
              scaleMultiplier:
                (result.request.overrides.scaleMultiplier ?? 1) *
                o.demandMultiplier.value!,
            }
          : {}),
      },
    });
    return {
      ...result,
      assumptions,
      request,
      scenario: {
        id: scenario.id,
        layoutId: scenario.layoutId,
        overrides: scenario.overrides,
        layout: selectedLayout,
      },
    };
  };
}
