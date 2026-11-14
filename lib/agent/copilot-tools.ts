import { z } from "zod";
import {
  CopilotMutationSchemas,
  CopilotMutationResultSchema,
  type CopilotMutationToolName,
  type CopilotMutationResult,
} from "@/lib/contracts/copilot-tools";
import { overrideOrigins, type Scenario } from "@/lib/contracts/scenario";
import {
  buildScenarioPatch,
  ScenarioPatchError,
  type ScenarioChange,
} from "@/lib/scenario/patch";
import { diffScenarios } from "@/lib/scenario/model";
import type { ScenarioService } from "@/lib/scenario/service";

export type CopilotMutationContext = {
  projectId: string;
  evidenceId: string;
  signal: AbortSignal;
};
const capacitySchema = z
  .array(
    z
      .object({
        siteId: z.string().min(1),
        maxStations: z.number().int().nonnegative(),
        layoutId: z.string().nullable(),
        layoutStations: z.number().int().positive().optional(),
        evidenceIds: z.array(z.string().min(1)).min(1),
      })
      .strict(),
  )
  .min(1)
  .max(8);
const candidatesSchema = z
  .object({
    candidateIds: z.array(z.string().min(1)).min(1).max(8),
    evidenceIds: z.array(z.string().min(1)).min(1),
  })
  .strict();
export type CopilotMutationDependencies = {
  scenarios: Pick<ScenarioService, "get" | "create">;
  validateCandidates?: (
    projectId: string,
    siteIds: string[],
    signal: AbortSignal,
  ) => Promise<z.infer<typeof candidatesSchema>>;
  /** Trusted scoped listing/layout capacity adapter; no model-authored SF or ceiling. */
  stationCapacity?: (
    projectId: string,
    scenario: Scenario,
    signal: AbortSignal,
  ) => Promise<z.infer<typeof capacitySchema>>;
};
const descriptions: Record<CopilotMutationToolName, string> = {
  fork_scenario:
    "Fork one immutable scenario version with a label and rationale.",
  set_hours:
    "Create one scenario version with same-day opening/closing minutes for a weekday or weekend.",
  set_staffing:
    "Create one scenario version with a constant staff headcount. Hourly staffing is unsupported.",
  set_price:
    "Requires the cached price-acceptance adapter; currently returns unsupported without writing a version.",
  set_stations:
    "Create one version only after trusted square-footage and selected-layout capacity validation.",
  add_sites:
    "Add unique candidate IDs to the scenario shortlist, keeping at most eight sites.",
  remove_sites:
    "Remove selected candidate IDs while keeping at least one site.",
  edit_layout:
    "Requires durable layout editing integration; currently returns unsupported without writing.",
  run_scenario:
    "Requires checkpointed scenario execution and budget enforcement; currently returns unsupported without running.",
};
const unsupported = (message: string): CopilotMutationResult => ({
  status: "unsupported",
  code: "ADAPTER_UNAVAILABLE",
  message,
});
const rejected = (
  code: Extract<CopilotMutationResult, { status: "rejected" }>["code"],
  message: string,
): CopilotMutationResult => ({ status: "rejected", code, message });

/** Injectable tool slice. It never calls a model, evaluates a scenario, or bypasses scenario service. */
export function createCopilotMutationTools(deps: CopilotMutationDependencies) {
  return {
    definitions: (
      Object.keys(CopilotMutationSchemas) as CopilotMutationToolName[]
    ).map((name) => ({
      name,
      schema: CopilotMutationSchemas[name],
      description: descriptions[name],
    })),
    async execute(
      name: CopilotMutationToolName,
      args: unknown,
      context: CopilotMutationContext,
    ): Promise<CopilotMutationResult> {
      context.signal.throwIfAborted();
      let parent: Scenario | undefined;
      try {
        z.string().trim().min(1).max(200).parse(context.projectId);
        z.string().trim().min(1).max(200).parse(context.evidenceId);
        const parsed = CopilotMutationSchemas[name]?.parse(args);
        if (!parsed)
          return rejected("INVALID_INPUT", "Unknown copilot mutation tool.");
        if (name === "run_scenario")
          return unsupported(
            "Checkpointed execution and project-budget integration are not available in this tool slice.",
          );
        if (name === "edit_layout")
          return unsupported(
            "Durable layout operations and scenario linkage are not available in this tool slice.",
          );
        if (name === "set_price")
          return unsupported(
            "Cached price-acceptance repricing must be integrated before this tool can change price.",
          );
        const fromId =
          "from_id" in parsed
            ? parsed.from_id
            : "scenario_id" in parsed
              ? parsed.scenario_id
              : "";
        parent = await deps.scenarios.get(context.projectId, fromId);
        if (parent.projectId !== context.projectId || parent.id !== fromId)
          return rejected("NOT_FOUND", "No such scenario in this project.");
        let change: ScenarioChange;
        switch (name) {
          case "fork_scenario": {
            const input = CopilotMutationSchemas.fork_scenario.parse(args);
            change = { kind: "fork", label: input.label };
            break;
          }
          case "set_hours": {
            const input = CopilotMutationSchemas.set_hours.parse(args);
            change = {
              kind: "hours",
              dayType: input.day_type,
              openMinute: input.open,
              closeMinute: input.close,
            };
            break;
          }
          case "set_staffing": {
            const input = CopilotMutationSchemas.set_staffing.parse(args);
            if (input.by_hour !== undefined)
              return unsupported(
                "Hourly staffing is not supported by the current scenario contract.",
              );
            change = { kind: "staffing", headcount: input.headcount! };
            break;
          }
          case "set_stations": {
            const input = CopilotMutationSchemas.set_stations.parse(args);
            if (!deps.stationCapacity)
              return unsupported(
                "A scoped listing/layout capacity adapter is required before setting stations.",
              );
            const capacities = capacitySchema.parse(
              await deps.stationCapacity(
                context.projectId,
                parent,
                context.signal,
              ),
            );
            const ids = capacities.map((row) => row.siteId);
            if (
              new Set(ids).size !== ids.length ||
              ids.length !== parent.siteIds.length ||
              parent.siteIds.some((id) => !ids.includes(id))
            )
              return rejected(
                "CAPACITY_CONFLICT",
                "Capacity evidence must cover exactly this scenario's selected sites.",
              );
            const layouts = capacities.filter((row) => row.layoutId !== null);
            const layoutMatches =
              parent.layoutId === null
                ? layouts.length === 0
                : layouts.length === 1 &&
                  layouts[0].layoutId === parent.layoutId &&
                  layouts[0].layoutStations === input.n;
            if (
              !layoutMatches ||
              capacities.some((row) => input.n > row.maxStations)
            )
              return rejected(
                "CAPACITY_CONFLICT",
                "The station count conflicts with listing square footage or the selected layout.",
              );
            change = { kind: "stations", count: input.n };
            break;
          }
          case "add_sites": {
            const input = CopilotMutationSchemas.add_sites.parse(args);
            if (!deps.validateCandidates)
              return unsupported(
                "A scoped candidate inventory adapter is required before adding sites.",
              );
            const known = candidatesSchema.parse(
              await deps.validateCandidates(
                context.projectId,
                input.site_ids,
                context.signal,
              ),
            );
            if (
              new Set(known.candidateIds).size !== input.site_ids.length ||
              known.candidateIds.length !== input.site_ids.length ||
              input.site_ids.some((id) => !known.candidateIds.includes(id))
            )
              return rejected(
                "INVALID_INPUT",
                "Every added site must resolve to a known candidate in this project.",
              );
            change = { kind: "add_sites", siteIds: input.site_ids };
            break;
          }
          case "remove_sites":
            change = {
              kind: "remove_sites",
              siteIds: CopilotMutationSchemas.remove_sites.parse(args).site_ids,
            };
            break;
          default:
            return rejected("INVALID_INPUT", "Unknown copilot mutation tool.");
        }
        const patch = buildScenarioPatch(parent, change, {
          origin: "default",
          evidenceIds: [context.evidenceId],
        });
        context.signal.throwIfAborted();
        const child = await deps.scenarios.create(context.projectId, {
          fromId,
          patch,
          author: "agent",
          rationale: "rationale" in parsed ? parsed.rationale : undefined,
        });
        const diff = diffScenarios(parent, child);
        const reference = (scenarioId: string, path: string) => ({
          kind: "scenario_value" as const,
          scenarioId,
          path,
        });
        return CopilotMutationResultSchema.parse({
          status: "created",
          scenarioId: child.id,
          parentId: parent.id,
          diff: {
            sites: diff.sites,
            changedPaths: [
              ...diff.scalars
                .filter(
                  (row) =>
                    ![
                      "id",
                      "parentId",
                      "author",
                      "rationale",
                      "createdAt",
                    ].includes(row.field),
                )
                .map((row) => row.field),
              ...diff.overrides.map((row) => `overrides.${row.key}`),
            ],
            values: diff.overrides.map((row) => ({
              before: row.from
                ? reference(parent!.id, `overrides.${row.key}`)
                : null,
              after: row.to
                ? reference(child.id, `overrides.${row.key}`)
                : null,
            })),
          },
        });
      } catch (error) {
        if (context.signal.aborted) throw error;
        if (error instanceof z.ZodError)
          return rejected(
            "INVALID_INPUT",
            "The tool arguments or capacity evidence are invalid.",
          );
        if (
          error &&
          typeof error === "object" &&
          "code" in error &&
          error.code === "not_found"
        )
          return rejected("NOT_FOUND", "No such scenario in this project.");
        // Preserve today's strict service invariant until the parent-aware owner change lands.
        if (
          parent &&
          overrideOrigins(parent.overrides).includes("founder") &&
          error instanceof Error &&
          /founder/.test(error.message)
        )
          return rejected(
            "PROVENANCE_CONFLICT",
            "This service currently rejects inherited founder overrides on agent versions. No version was created; provenance was preserved.",
          );
        if (error instanceof ScenarioPatchError)
          return rejected("INVALID_INPUT", "The shortlist change is invalid.");
        return rejected(
          "UNAVAILABLE",
          "The scenario change could not be completed.",
        );
      }
    },
  };
}
