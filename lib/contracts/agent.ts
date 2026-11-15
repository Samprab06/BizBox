import { z } from "zod";
import { MAX_COMPARE_UNITS, SiteTweaksSchema } from "./evaluation";

/**
 * HAC-134 (AGT-14): what the consultant sees of the current screen and the UI actions it
 * may ask the client to take. The intake reply carries these today; HAC-83 (AGT-4 Copilot
 * runtime) adopts the same union for its streamed `ui_action` events.
 */

const Id = z.string().trim().min(1).max(200);

/**
 * Every `WorkspaceRoute` (lib/client/workspace-routes.ts) plus `interior`. A test keeps this
 * list in step with `WorkspaceRoute`, so add a route there and here together.
 */
export const AgentStageSchema = z.enum([
  "intake",
  "workspace",
  "map",
  "site",
  "comparison",
  "replay",
  "simulator",
  "plan",
  "interior",
]);
export type AgentStage = z.infer<typeof AgentStageSchema>;

/** The union of the `phase` values the workspace screens report (lib/client/workspace-context.ts). */
export const AgentViewPhaseSchema = z.enum([
  "loading",
  "ready",
  "example",
  "live",
  "running",
  "outdated",
  "error",
  "missing",
]);
export type AgentViewPhase = z.infer<typeof AgentViewPhaseSchema>;

export const MAX_VIEW_CANDIDATES = 8;
const Minute = z.number().int().min(0).max(1439);

/**
 * Scene 1: the guided flow's steps, in order. The top stepper shows them; the consultant
 * moves the founder forward with `go_to_step`. `questions` is the questionnaire (no chat);
 * the rest live on `/workspace?step=<step>`.
 */
export const FLOW_STEP_IDS = [
  "questions",
  "locations",
  "compare",
  "results",
  "finalize",
] as const;
export const FlowStepSchema = z.enum(FLOW_STEP_IDS);
export type FlowStep = z.infer<typeof FlowStepSchema>;

/** Scene 1: facts about one visible candidate, so the consultant can present the top 3. */
export const AgentViewCandidateSchema = z
  .object({
    id: Id,
    address: z.string().trim().min(1).max(300),
    monthlyRentUsd: z.number().nonnegative().finite().optional(),
    sqft: z.number().positive().finite().optional(),
    /** The search's ranking score (higher is better), when the listing has one. */
    score: z.number().finite().optional(),
  })
  .strict();
export type AgentViewCandidate = z.infer<typeof AgentViewCandidateSchema>;

/** What the founder is looking at when they send a message. */
export const AgentViewContextSchema = z
  .object({
    stage: AgentStageSchema,
    siteId: Id.optional(),
    comparisonId: Id.optional(),
    investigationId: Id.optional(),
    scenarioId: Id.optional(),
    candidateIds: z.array(Id).max(MAX_VIEW_CANDIDATES).optional(),
    /** Scene 1: facts for the candidates in `candidateIds` order (ranked best first). */
    candidates: z
      .array(AgentViewCandidateSchema)
      .max(MAX_VIEW_CANDIDATES)
      .optional(),
    /** Scene 1: the units currently in the comparison shortlist. */
    shortlistIds: z.array(Id).max(MAX_COMPARE_UNITS).optional(),
    /** Scene 1: the guided-flow step the founder is on. */
    step: FlowStepSchema.optional(),
    minute: Minute.optional(),
    phase: AgentViewPhaseSchema.optional(),
  })
  .strict();
export type AgentViewContext = z.infer<typeof AgentViewContextSchema>;

/**
 * Elements the consultant may point at. Only these anchors exist, so a model cannot ask the
 * client to highlight an arbitrary selector. Screens mark them with `data-agent-anchor`.
 */
export const HighlightTargetSchema = z.enum([
  "intake_form",
  "map",
  "candidate_list",
  "site_summary",
  "site_economics",
  "comparison_table",
  "comparison_recommendation",
  "replay_timeline",
  "simulator_controls",
  "interior_floorplan",
  "plan_summary",
  "assumptions",
]);
export type HighlightTarget = z.infer<typeof HighlightTargetSchema>;

export const MAX_FOCUS_SITES = 8;
const actionId = { id: Id };

export const NavigateActionSchema = z
  .object({
    ...actionId,
    type: z.literal("navigate"),
    stage: AgentStageSchema,
    siteId: Id.optional(),
    comparisonId: Id.optional(),
    investigationId: Id.optional(),
  })
  .strict();
export const OpenSiteActionSchema = z
  .object({ ...actionId, type: z.literal("open_site"), siteId: Id })
  .strict();
export const FocusMapActionSchema = z
  .object({
    ...actionId,
    type: z.literal("focus_map"),
    siteIds: z.array(Id).min(1).max(MAX_FOCUS_SITES),
  })
  .strict();
export const ShowComparisonActionSchema = z
  .object({
    ...actionId,
    type: z.literal("show_comparison"),
    comparisonId: Id.optional(),
    investigationId: Id.optional(),
  })
  .strict();
export const OpenSimulatorActionSchema = z
  .object({
    ...actionId,
    type: z.literal("open_simulator"),
    comparisonId: Id.optional(),
    siteId: Id.optional(),
  })
  .strict();
export const OpenInteriorActionSchema = z
  .object({
    ...actionId,
    type: z.literal("open_interior"),
    siteId: Id,
    minute: Minute.optional(),
  })
  .strict();
export const ShowPlanActionSchema = z
  .object({ ...actionId, type: z.literal("show_plan"), comparisonId: Id })
  .strict();
export const HighlightActionSchema = z
  .object({
    ...actionId,
    type: z.literal("highlight"),
    target: HighlightTargetSchema,
  })
  .strict();

/** HAC-151: replaces the project's comparison shortlist (the client store, HAC-135). */
export const SetShortlistActionSchema = z
  .object({
    ...actionId,
    type: z.literal("set_shortlist"),
    siteIds: z.array(Id).min(1).max(MAX_FOCUS_SITES),
  })
  .strict();
/**
 * HAC-151: the client runs the comparison for these sites (the existing comparison path, which
 * can outlast the 30 s turn), then opens it as it would for `show_comparison`.
 */
export const RunComparisonActionSchema = z
  .object({
    ...actionId,
    type: z.literal("run_comparison"),
    siteIds: z.array(Id).min(1).max(MAX_FOCUS_SITES),
  })
  .strict();

/** Scene 1: the consultant presents these as the founder's top locations (ranked). */
export const PresentTopSitesActionSchema = z
  .object({
    ...actionId,
    type: z.literal("present_top_sites"),
    siteIds: z.array(Id).min(1).max(MAX_COMPARE_UNITS),
  })
  .strict();
/** Scene 1: per-site hours/price/staff/rent applied to the next comparison run. */
export const SetSiteTweaksActionSchema = z
  .object({
    ...actionId,
    type: z.literal("set_site_tweaks"),
    candidateId: Id,
    tweaks: SiteTweaksSchema,
  })
  .strict();
/** Scene 1: move the founder to a guided-flow step (never past one that is locked). */
export const GoToStepActionSchema = z
  .object({ ...actionId, type: z.literal("go_to_step"), step: FlowStepSchema })
  .strict();
/** Scene 1: the founder accepted a site; the client stores it and opens the summary. */
export const FinalizePlanActionSchema = z
  .object({
    ...actionId,
    type: z.literal("finalize_plan"),
    comparisonId: Id,
    chosenSiteId: Id,
    rationale: z.string().trim().min(1).max(2000),
  })
  .strict();

export const UiActionSchema = z.discriminatedUnion("type", [
  NavigateActionSchema,
  OpenSiteActionSchema,
  FocusMapActionSchema,
  ShowComparisonActionSchema,
  OpenSimulatorActionSchema,
  OpenInteriorActionSchema,
  ShowPlanActionSchema,
  HighlightActionSchema,
  SetShortlistActionSchema,
  RunComparisonActionSchema,
  PresentTopSitesActionSchema,
  SetSiteTweaksActionSchema,
  GoToStepActionSchema,
  FinalizePlanActionSchema,
]);
export type UiAction = z.infer<typeof UiActionSchema>;
export type UiActionType = UiAction["type"];

/** At most this many actions ride on one reply. */
export const MAX_UI_ACTIONS = 3;
export const UiActionListSchema = z.array(UiActionSchema).max(MAX_UI_ACTIONS);

/**
 * Scene 1: things that happen in the browser that the consultant should react to. The client
 * posts one as `event` on the intake route (with no founder `message`); the consultant
 * replies as a normal turn, e.g. greeting with the top 3 or narrating a running comparison.
 */
export const FlowEventSchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("arrived_workspace") }).strict(),
  z
    .object({
      kind: z.literal("comparison_started"),
      siteIds: z.array(Id).min(1).max(MAX_COMPARE_UNITS),
      demandSource: z.enum(["jev", "huff"]),
    })
    .strict(),
  z
    .object({
      kind: z.literal("comparison_progress"),
      completed: z.number().int().nonnegative(),
      total: z.number().int().positive(),
    })
    .strict(),
  z
    .object({ kind: z.literal("comparison_finished"), comparisonId: Id })
    .strict(),
  z
    .object({
      kind: z.literal("comparison_failed"),
      reason: z.string().trim().min(1).max(300).optional(),
    })
    .strict(),
]);
export type FlowEvent = z.infer<typeof FlowEventSchema>;
export type FlowEventKind = FlowEvent["kind"];
