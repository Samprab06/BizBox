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
  /** Trusted workspace snapshot; never supplied by model arguments. */
  scenarioId?: string;
  profileVersion?: number;
  idempotencyKey?: string;
  runConfirmed?: boolean;
  budgetConfirmed?: boolean;
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
const priceEvidenceSchema = z
  .object({
    comparisonId: z.string().min(1).max(200).nullable(),
    siteIds: z.array(z.string().min(1).max(200)).max(8),
    status: z.enum(["cached_curve", "unavailable", "tier_requires_run"]),
  })
  .strict();
export type CopilotMutationDependencies = {
  scenarios: Pick<ScenarioService, "get" | "create">;
  priceAcceptance?: (
    projectId: string,
    scenario: Scenario,
    change: Extract<ScenarioChange, { kind: "price" | "price_tier" }>,
    signal: AbortSignal,
  ) => Promise<{
    comparisonId: string | null;
    siteIds: string[];
    status: "cached_curve" | "unavailable" | "tier_requires_run";
  }>;
  validateCandidates?: (
    projectId: string,
    siteIds: string[],
    signal: AbortSignal,
    scenario?: Scenario,
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
    "Propose a price or tier change using cached acceptance evidence only; never calls a paid panel or runs the scenario.",
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
        if (context.scenarioId !== undefined)
          z.string().trim().min(1).max(200).parse(context.scenarioId);
        if (context.profileVersion !== undefined)
          z.number().int().positive().parse(context.profileVersion);
        if (context.idempotencyKey !== undefined)
          z.string().trim().min(1).max(200).parse(context.idempotencyKey);
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
        const fromId =
          "from_id" in parsed
            ? parsed.from_id
            : "scenario_id" in parsed
              ? parsed.scenario_id
              : "";
        parent = await deps.scenarios.get(context.projectId, fromId);
        if (parent.projectId !== context.projectId || parent.id !== fromId)
          return rejected("NOT_FOUND", "No such scenario in this project.");
        if (
          (context.scenarioId !== undefined &&
            context.scenarioId !== parent.id) ||
          (context.profileVersion !== undefined &&
            context.profileVersion !== parent.profileVersion)
        )
          return rejected(
            "STALE_CONTEXT",
            "The workspace context changed. Refresh before proposing a change.",
          );
        let priceAcceptance:
          | Awaited<
              ReturnType<
                NonNullable<CopilotMutationDependencies["priceAcceptance"]>
              >
            >
          | undefined;
        let change: ScenarioChange;
        switch (name) {
          case "set_price": {
            const input = CopilotMutationSchemas.set_price.parse(args);
            if (!deps.priceAcceptance)
              return unsupported(
                "A scoped cached price-acceptance adapter is required.",
              );
            if (
              input.avg_ticket !== undefined &&
              Math.abs(
                input.avg_ticket * 100 - Math.round(input.avg_ticket * 100),
              ) > 1e-7
            )
              return rejected(
                "INVALID_INPUT",
                "Average ticket must be expressed in whole cents.",
              );
            change =
              input.avg_ticket !== undefined
                ? {
                    kind: "price",
                    averageTicketCents: Math.round(input.avg_ticket * 100),
                  }
                : { kind: "price_tier", tier: input.tier! };
            priceAcceptance = priceEvidenceSchema.parse(
              await deps.priceAcceptance(
                context.projectId,
                parent,
                change,
                context.signal,
              ),
            );
            if (
              priceAcceptance.siteIds.some(
                (id) => !parent!.siteIds.includes(id),
              ) ||
              new Set(priceAcceptance.siteIds).size !==
                priceAcceptance.siteIds.length ||
              (priceAcceptance.status === "cached_curve" &&
                (change.kind !== "price" ||
                  !priceAcceptance.comparisonId ||
                  priceAcceptance.siteIds.length !== parent.siteIds.length))
            )
              return rejected(
                "INVALID_INPUT",
                "Cached price evidence does not match the scenario.",
              );
            break;
          }
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
                parent,
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
        const child = await deps.scenarios.create(
          context.projectId,
          {
            fromId,
            patch,
            author: "agent",
            rationale: "rationale" in parsed ? parsed.rationale : undefined,
          },
          context.idempotencyKey
            ? { idempotencyKey: context.idempotencyKey }
            : undefined,
        );
        context.signal.throwIfAborted();
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
          ...(priceAcceptance
            ? {
                priceAcceptance: {
                  status: priceAcceptance.status,
                  references:
                    priceAcceptance.status === "cached_curve"
                      ? priceAcceptance.siteIds.map((siteId) => ({
                          kind: "price_acceptance_shift",
                          comparisonId: priceAcceptance!.comparisonId!,
                          scenarioId: child.id,
                          siteId,
                        }))
                      : [],
                },
              }
            : {}),
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
        // Never relabel inherited founder inputs to get an agent proposal accepted.
        if (
          parent &&
          overrideOrigins(parent.overrides).includes("founder") &&
          error instanceof Error &&
          /founder/.test(error.message)
        )
          return rejected(
            "PROVENANCE_CONFLICT",
            "An agent cannot introduce or change founder-attributed values. Inherited evidence must remain unchanged.",
          );
        if (error instanceof ScenarioPatchError)
          return rejected("INVALID_INPUT", "The shortlist change is invalid.");
        if (
          error &&
          typeof error === "object" &&
          "code" in error &&
          error.code === "invalid"
        )
          return rejected(
            "INVALID_INPUT",
            "The scenario request conflicts with the saved action or provenance.",
          );
        return rejected(
          "UNAVAILABLE",
          "The scenario change could not be completed.",
        );
      }
    },
  };
}
