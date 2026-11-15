import { z } from "zod";

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

/** What the founder is looking at when they send a message. */
export const AgentViewContextSchema = z
  .object({
    stage: AgentStageSchema,
    siteId: Id.optional(),
    comparisonId: Id.optional(),
    investigationId: Id.optional(),
    scenarioId: Id.optional(),
    candidateIds: z.array(Id).max(MAX_VIEW_CANDIDATES).optional(),
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
]);
export type UiAction = z.infer<typeof UiActionSchema>;
export type UiActionType = UiAction["type"];

/** At most this many actions ride on one reply. */
export const MAX_UI_ACTIONS = 3;
export const UiActionListSchema = z.array(UiActionSchema).max(MAX_UI_ACTIONS);
