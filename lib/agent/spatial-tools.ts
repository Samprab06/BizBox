import { buildControlledExperimentFinding } from "@/lib/interior/controlled-experiment";
import { makeDemo, demoPlan } from "@/components/simulator/fixture";
/** FDE commands for local, scoped interior experiments. No provider calls or model-authored metrics. */
import { z } from "zod";
import { SpatialCommandSchema } from "@/lib/contracts/spatial";
import { FURNITURE_CATALOG } from "@/lib/furniture/catalog";
import {
  applySpatialCommand,
  runSpatialExperiment,
  spatialReadiness,
} from "@/lib/spatial";
import { MAX_UI_ACTIONS, type UiAction } from "@/lib/contracts/agent";
import type { IntakeUiContext } from "./ui-tools";
const Id = z.string().trim().min(1).max(200);
const SPECS = {
  test_interior_change: {
    schema: z
      .object({
        siteId: Id,
        catalogId: Id,
        question: z.string().trim().min(1).max(1000),
        position: z
          .object({ x: z.number().finite(), z: z.number().finite() })
          .strict()
          .optional(),
      })
      .strict(),
    description:
      "Test ONE catalog furniture addition against the CURRENT layout as a new controlled baseline. Holds staffing, capacity, workload, hours, prices, service and other furniture fixed. Queues native placement and Jev-backed run; queued is not completed. A table alone adds no seats/service capacity; outcomes may be zero or unfavorable. Use actual catalog IDs. Position is optional room meters; screen chooses an in-bounds placement if absent.",
  },
  read_interior_affordability: {
    schema: z.object({ siteId: Id, accountId: Id.optional() }).strict(),
    description:
      "Read the existing Nessie simulated sandbox funds and affordability for this exact reviewed interior/site and stored comparison. Read-only: never creates accounts or moves money. Balances and known costs come from trusted services, never model arguments. Unknown furniture/equipment costs keep affordability/ROI incomplete. If several demo accounts are returned ask which to use; never sum them. Queues the server-computed assessment onto the current screen/report.",
  },
  read_reference_cafe: {
    schema: z.object({}).strict(),
    description:
      "Read the defined Coffee Port public reference interior: fixed one/two staffed counter runs, shared 110-customer workload, assumptions and example economics. Not the selected property or live Jev.",
  },
  set_reference_cafe: {
    schema: z
      .object({
        siteId: Id,
        selectedPlan: z.union([z.literal(0), z.literal(1)]),
        reviewed: z.boolean(),
      })
      .strict(),
    description:
      "Select one (0) or two (1) staffed counters in the in-workspace Coffee Port reference replay. Set reviewed true only when the founder accepts the reference results. The selected location economics remain separate. Does not remove photographed furniture.",
  },
  read_furniture_catalog: {
    schema: z.object({}).strict(),
    description:
      "Read available furniture IDs, sizes and roles. Assets are Poly Haven render models; prices and equipment performance are not supplied. Never invent catalog IDs.",
  },
  read_interior_experiment: {
    schema: z.object({}).strict(),
    description:
      "Read the selected building's current layout, settings and baseline/proposal results. Reports assumed or server-verified Jev behavior explicitly; neither is observed business data. Rejects unverified client-provided Jev policies.",
  },
  edit_interior: {
    schema: z.object({ siteId: Id, command: SpatialCommandSchema }).strict(),
    description:
      "Preview and apply a founder-requested interior edit. Add/remove/move/rotate or clear catalog furniture, replace operating settings, or change entrance/servicePoint with a layout command. Coordinates are meters in the current room, rotation degrees. Clear removes proposed objects, not photographed Matterport furniture or fixed service infrastructure. Use IDs from read_furniture_catalog/current view.",
  },
  run_interior_experiment: {
    schema: z
      .object({
        siteId: Id,
        behavior: z.enum(["jev", "assumed"]).default("jev"),
      })
      .strict(),
    description:
      "Prepare Jev-backed decisions and run the current baseline versus proposal when requested. behavior defaults to jev; use assumed only when the founder explicitly requests an assumption-based preview. Jev preparation requires server credentials, current state coverage and authorized budget; failures do not silently fall back. The queued screen action is not a completed run.",
  },
  review_interior: {
    schema: z.object({ siteId: Id }).strict(),
    description:
      "Mark the current completed interior experiment reviewed when the founder accepts it. Does not itself finalize the exterior/interior report.",
  },
} as const;
export type SpatialToolName = keyof typeof SPECS;
export const SPATIAL_TOOL_SPECS = Object.entries(SPECS).map(([name, spec]) => {
  const schema = z.toJSONSchema(spec.schema, {
    unrepresentable: "any",
  }) as Record<string, unknown>;
  delete schema.$schema;
  return {
    name: name as SpatialToolName,
    description: spec.description,
    schema,
  };
});
export function createSpatialToolExecutor(context: IntakeUiContext) {
  const done = new Map<string, string>();
  let working: import("@/lib/contracts/spatial").SpatialDraft | undefined;
  let workingReference:
    | { modelId: "qfmMbTLt4Bo"; selectedPlan: 0 | 1; reviewed: boolean }
    | undefined;
  const execute = async (
    name: SpatialToolName,
    args: unknown,
  ): Promise<string> => {
    try {
      const parsed = SPECS[name].schema.parse(args);
      if (name === "read_furniture_catalog")
        return JSON.stringify({
          items: FURNITURE_CATALOG,
          limitations: [
            "Render assets do not supply prices or calibrated business performance.",
          ],
        });
      const view = context.view,
        original = view?.spatial;
      const spatial = original
        ? {
            ...original,
            draft: working ?? original.draft,
            policies: working ? undefined : original.policies,
            policyReceipt: working ? undefined : original.policyReceipt,
            reviewed: working ? false : original.reviewed,
            reference:
              workingReference === undefined
                ? original.reference
                : (workingReference ?? undefined),
          }
        : undefined;
      if (
        !spatial ||
        !view?.comparisonId ||
        spatial.comparisonId !== view.comparisonId ||
        spatial.baseline.projectId !== context.projectId ||
        spatial.draft.projectId !== context.projectId ||
        spatial.baseline.siteId !== view.siteId ||
        spatial.draft.siteId !== view.siteId ||
        spatial.baseline.id !== spatial.draft.id
      )
        throw new Error(
          "Open the selected interior after a saved exterior comparison.",
        );
      if (
        !(await context.lookups.comparisonExists(
          context.projectId,
          spatial.comparisonId,
        ))
      )
        throw new Error("Exterior comparison is unavailable for this project.");
      if (context.results) {
        const record = await context.results.load(
          context.projectId,
          spatial.comparisonId,
        );
        if (
          !record ||
          record.evaluation.result.projectId !== context.projectId ||
          !record.evaluation.result.sites.some(
            (s) => s.siteId === spatial.draft.siteId,
          )
        )
          throw new Error("Interior site is not in the saved comparison.");
      }
      if ("siteId" in parsed && parsed.siteId !== spatial.draft.siteId)
        throw new Error("Interior command belongs to another site.");
      const selectedSite = await context.lookups.site(spatial.draft.siteId);
      if (!selectedSite) throw new Error("Unknown interior site.");
      const expectedCity =
        spatial.draft.city === "houston" ? "houston" : "los angeles";
      if (
        selectedSite.city?.trim() &&
        selectedSite.city.trim().toLowerCase() !== expectedCity
      )
        throw new Error(
          "Interior draft city does not match the selected site.",
        );
      const key = JSON.stringify({
        name,
        parsed,
        ...(name === "read_interior_affordability"
          ? { draft: spatial.draft, policies: spatial.policies }
          : {}),
      });
      if (done.has(key)) return done.get(key)!;
      if (name === "read_interior_experiment") {
        if (
          spatial.policies &&
          (!spatial.policyReceipt ||
            !context.verifyInteriorPolicies ||
            !(await context.verifyInteriorPolicies({
              projectId: context.projectId,
              comparisonId: spatial.comparisonId,
              baseline: spatial.baseline,
              variant: spatial.draft,
              policies: spatial.policies,
              receipt: spatial.policyReceipt,
            })))
        )
          throw new Error(
            "Saved Jev policy evidence could not be verified by the server. Prepare current decisions again before reporting them as Jev-backed.",
          );
        const readiness = spatialReadiness(spatial.draft);
        const result = readiness.runnable
          ? runSpatialExperiment({
              baseline: spatial.baseline,
              variant: spatial.draft,
              policies: spatial.policies,
            })
          : null;
        const completed = spatial.ranRevision === spatial.draft.revision;
        let controlledFinding: ReturnType<
          typeof buildControlledExperimentFinding
        > | null = null;
        if (completed && result && spatial.experimentQuestion) {
          try {
            controlledFinding = buildControlledExperimentFinding({
              question: spatial.experimentQuestion,
              baseline: spatial.baseline,
              variant: spatial.draft,
              result,
            });
          } catch {
            /* Generic multi-variable previews do not become controlled findings. */
          }
        }
        return JSON.stringify({
          status: completed ? "completed" : "preview",
          controlledFinding,
          completionNote: completed
            ? "Current revision completed; findings recomputed from validated inputs."
            : "Recomputed preview only; the native placement and current experiment run have not completed.",
          draft: spatial.draft,
          interiorSource: spatial.source ?? null,
          geometrySource: spatial.draft.room.source,
          sourceNote:
            "Interior source is the current screen snapshot; operating behavior remains assumed unless an authenticated validated policy is supplied.",
          readiness,
          behaviorSource: result?.source ?? "assumed",
          metrics: result?.variant.metrics,
          delta: result?.delta,
          findings: result?.findings,
          limitations: result?.limitations,
        });
      }
      if (name === "read_reference_cafe")
        return JSON.stringify({
          modelId: "qfmMbTLt4Bo",
          current: spatial.reference ?? null,
          plans: makeDemo().map((d, i) => ({
            selectedPlan: i,
            served: d.run.metrics.served,
            left: d.run.metrics.abandoned,
            meanWaitMin: d.run.metrics.meanWaitMin,
            monthlyContributionUsd: d.monthly.contributionUsd,
          })),
          assumptions: demoPlan,
          limitations: [
            "Public reference scan, not selected property.",
            "110 synthetic customers and authored behavior, not live Jev.",
            "Fixture monthly contribution does not replace selected-location economics.",
            "Scan defurnishing unavailable unless a provider-generated defurnished view is verified.",
          ],
        });
      const scope = {
        comparisonId: spatial.comparisonId,
        draftId: spatial.draft.id,
        expectedRevision: spatial.draft.revision,
      };
      if (name === "read_interior_affordability") {
        if (!spatial.reviewed || !context.readInteriorAffordability)
          throw new Error(
            "Review the current interior result before requesting sandbox affordability; the read-only server integration must be configured.",
          );
        const { accountId } =
          SPECS.read_interior_affordability.schema.parse(parsed);
        const assessment = await context.readInteriorAffordability(
          context.projectId,
          {
            comparisonId: spatial.comparisonId,
            siteId: spatial.draft.siteId,
            baseline: spatial.baseline,
            draft: spatial.draft,
            ranRevision: spatial.draft.revision,
            reviewedRevision: spatial.draft.revision,
            ...(spatial.policies
              ? {
                  policies: spatial.policies,
                  policyReceipt: spatial.policyReceipt,
                }
              : {}),
            ...(accountId ? { accountId } : {}),
          },
        );
        if (context.actions.length >= MAX_UI_ACTIONS)
          throw new Error("Screen action limit reached.");
        context.actions.push({
          ...scope,
          id: context.newId(),
          type: "set_interior_affordability",
          siteId: spatial.draft.siteId,
          assessment,
          ...(accountId ? { accountId } : {}),
        });
        const response = JSON.stringify(assessment);
        done.set(key, response);
        return response;
      }
      let action: UiAction;
      if (name === "test_interior_change") {
        const request = SPECS.test_interior_change.schema.parse(parsed);
        if (!FURNITURE_CATALOG.some((item) => item.id === request.catalogId))
          throw new Error("Unknown furniture catalog item.");
        if (
          request.position &&
          (request.position.x < 0 ||
            request.position.z < 0 ||
            request.position.x > spatial.draft.room.widthM ||
            request.position.z > spatial.draft.room.depthM)
        )
          throw new Error("Experiment position is outside the current room.");
        if (context.actions.length >= MAX_UI_ACTIONS)
          throw new Error("Screen action limit reached.");
        context.actions.push({
          ...scope,
          id: context.newId(),
          type: "propose_interior_experiment",
          siteId: spatial.draft.siteId,
          catalogId: request.catalogId,
          question: request.question,
          ...(request.position ? { position: request.position } : {}),
        });
        const reply = JSON.stringify({
          queued: true,
          completed: false,
          baselineRevision: spatial.draft.revision,
          message:
            "Placement and controlled Jev experiment requested; read the current experiment after the screen completes it.",
        });
        done.set(key, reply);
        return reply;
      }
      if (name === "edit_interior") {
        const { command } = SPECS.edit_interior.schema.parse(parsed);
        const preview = applySpatialCommand(spatial.draft, command);
        action = {
          ...scope,
          id: context.newId(),
          type: "spatial_edit",
          siteId: spatial.draft.siteId,
          command,
        };
        if (context.actions.length >= MAX_UI_ACTIONS)
          throw new Error("Screen action limit reached.");
        context.actions.push(action);
        working = preview;
        const reply = JSON.stringify({
          queued: true,
          revision: preview.revision,
          items: preview.items,
          limitations: preview.limitations,
        });
        done.set(key, reply);
        return reply;
      }
      if (name === "set_reference_cafe") {
        if (spatial.source)
          throw new Error(
            "The selected-building experiment uses its own layout and results. Reference café controls cannot change it.",
          );
        const { selectedPlan, reviewed } =
          SPECS.set_reference_cafe.schema.parse(parsed);
        action = {
          ...scope,
          id: context.newId(),
          type: "set_reference_cafe",
          expectedReference: spatial.reference ?? null,
          siteId: spatial.draft.siteId,
          selectedPlan,
          reviewed,
        };
      } else if (name === "run_interior_experiment") {
        const { behavior } = SPECS.run_interior_experiment.schema.parse(parsed);
        const readiness = spatialReadiness(spatial.draft);
        if (!readiness.runnable)
          throw new Error("Interior is not runnable; inspect readiness first.");
        runSpatialExperiment({
          baseline: spatial.baseline,
          variant: spatial.draft,
        });
        action = {
          ...scope,
          id: context.newId(),
          type: "run_spatial_experiment",
          behavior,
          siteId: spatial.draft.siteId,
        };
      } else
        action = {
          ...scope,
          id: context.newId(),
          type: "review_interior",
          siteId: spatial.draft.siteId,
        };
      if (context.actions.length >= MAX_UI_ACTIONS)
        throw new Error("Screen action limit reached.");
      context.actions.push(action);
      if (action.type === "set_reference_cafe")
        workingReference = {
          modelId: "qfmMbTLt4Bo",
          selectedPlan: action.selectedPlan,
          reviewed: action.reviewed,
        };
      const reply = JSON.stringify({ queued: true, type: action.type });
      done.set(key, reply);
      return reply;
    } catch (error) {
      return `Error: ${error instanceof z.ZodError ? "Invalid interior command." : error instanceof Error ? error.message : "Interior command failed."} Nothing was done.`;
    }
  };
  let pending: Promise<unknown> = Promise.resolve();
  return (name: SpatialToolName, args: unknown) => {
    const next = pending.then(() => execute(name, args));
    pending = next.catch(() => undefined);
    return next;
  };
}
