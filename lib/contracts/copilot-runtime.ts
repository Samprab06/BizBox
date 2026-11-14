import { z } from "zod";

export const CopilotIdSchema = z.string().trim().min(1).max(200);
const Text = z.string().trim().min(1).max(8000);

/** A selection snapshot, not an authorization grant. Resolve IDs in project scope
 * on the server before using them; revision fences asynchronous UI results. */
export const CopilotContextSchema = z
  .object({
    projectId: CopilotIdSchema,
    profileId: CopilotIdSchema.optional(),
    profileVersion: z.number().int().positive().optional(),
    siteId: CopilotIdSchema.optional(),
    scenarioId: CopilotIdSchema.optional(),
    runId: CopilotIdSchema.optional(),
    day: z.enum(["weekday", "weekend"]).optional(),
    minute: z.number().int().min(0).max(1439).optional(),
    page: z.string().trim().min(1).max(500),
    view: z.enum(["city", "space", "interior", "comparison", "plan", "intake"]),
    selectedCustomerId: CopilotIdSchema.optional(),
    chartId: CopilotIdSchema.optional(),
    revision: z.number().int().nonnegative(),
  })
  .strict();
export type CopilotContext = z.infer<typeof CopilotContextSchema>;

/** Origins remain explicit even when a payload contains no numeric claims. */
export const CopilotSourceLabelSchema = z
  .object({
    kind: z.enum([
      "real_evidence",
      "modeled",
      "default",
      "jev",
      "fallback",
      "interior",
    ]),
    label: Text,
    evidenceIds: z.array(CopilotIdSchema).max(100),
    origin: z.enum(["costar", "public", "founder", "default"]).optional(),
    interiorSource: z.enum(["matterport", "modeled", "unavailable"]).optional(),
  })
  .strict()
  .superRefine((value, ctx) => {
    if (
      value.kind === "real_evidence" &&
      (!value.origin || value.evidenceIds.length === 0)
    )
      ctx.addIssue({
        code: "custom",
        message: "Real evidence requires origin and evidence IDs",
      });
    if (value.kind === "interior" && !value.interiorSource)
      ctx.addIssue({ code: "custom", message: "Interior source is required" });
  });
export type CopilotSourceLabel = z.infer<typeof CopilotSourceLabelSchema>;

export const CopilotTodoSchema = z
  .object({
    id: CopilotIdSchema,
    content: Text,
    status: z.enum(["pending", "in_progress", "completed"]),
  })
  .strict();
export type CopilotTodo = z.infer<typeof CopilotTodoSchema>;

export const CopilotProposalSchema = z
  .object({
    id: CopilotIdSchema,
    baseScenarioId: CopilotIdSchema,
    proposedScenarioId: CopilotIdSchema.optional(),
    title: Text,
    description: Text,
    status: z.enum(["pending", "run_requested", "kept", "reverted"]),
    evidenceIds: z.array(CopilotIdSchema).max(100),
  })
  .strict();
export type CopilotProposal = z.infer<typeof CopilotProposalSchema>;

export const CopilotTurnRequestSchema = z
  .object({
    message: Text,
    context: CopilotContextSchema,
    requestId: CopilotIdSchema,
    proposalAction: z
      .object({
        proposalId: CopilotIdSchema,
        action: z.enum(["run", "keep", "revert"]),
        /** Separate, explicit confirmation of the project rolling budget. */
        confirmBudget: z.boolean().optional(),
      })
      .strict()
      .refine(
        (action) =>
          action.action === "run" || action.confirmBudget === undefined,
        "Budget confirmation only applies to Run",
      )
      .optional(),
  })
  .strict();
export type CopilotTurnRequest = z.infer<typeof CopilotTurnRequestSchema>;
export const CopilotAdvanceRequestSchema = z
  .object({ context: CopilotContextSchema })
  .strict();
export type CopilotAdvanceRequest = z.infer<typeof CopilotAdvanceRequestSchema>;
export const CopilotTurnStatusSchema = z.enum([
  "running",
  "paused",
  "completed",
  "failed",
  "cancelled",
]);
export type CopilotTurnStatus = z.infer<typeof CopilotTurnStatusSchema>;

const envelope = {
  threadId: CopilotIdSchema,
  turnId: CopilotIdSchema,
  sequence: z.number().int().nonnegative(),
  context: CopilotContextSchema,
};
const event = <T extends z.ZodRawShape>(shape: T) =>
  z.object({ ...envelope, ...shape }).strict();
/** SSE data is one validated event. Sequence is monotonic within a turn and is
 * persisted with it; clients may deduplicate replay by (turnId, sequence). */
export const CopilotEventSchema = z.discriminatedUnion("type", [
  event({ type: z.literal("turn_started"), requestId: CopilotIdSchema }),
  event({
    type: z.literal("assistant_delta"),
    text: z.string().min(1).max(8000),
    sources: z.array(CopilotSourceLabelSchema).max(100),
  }),
  event({
    type: z.literal("tool_started"),
    callId: CopilotIdSchema,
    tool: CopilotIdSchema,
  }),
  event({
    type: z.literal("tool_completed"),
    callId: CopilotIdSchema,
    tool: CopilotIdSchema,
    result: z.unknown(),
    sources: z.array(CopilotSourceLabelSchema).max(100),
  }),
  event({
    type: z.literal("todos"),
    todos: z.array(CopilotTodoSchema).max(100),
  }),
  event({ type: z.literal("proposal"), proposal: CopilotProposalSchema }),
  event({
    type: z.literal("ui"),
    action: z.enum([
      "focus_view",
      "select_site",
      "select_customer",
      "show_chart",
      "seek",
    ]),
    target: CopilotContextSchema,
  }),
  event({
    type: z.literal("limit"),
    reason: z.enum(["tool_calls", "wall_time", "project_cost"]),
    message: Text,
    resumable: z.boolean(),
  }),
  event({
    type: z.literal("turn_finished"),
    status: CopilotTurnStatusSchema,
    message: Text,
  }),
  event({
    type: z.literal("error"),
    code: z.enum([
      "NOT_CONFIGURED",
      "INVALID_CONTEXT",
      "STALE_CONTEXT",
      "NOT_FOUND",
      "CONFLICT",
      "INTERNAL",
    ]),
    message: Text,
  }),
]);
export type CopilotEvent = z.infer<typeof CopilotEventSchema>;

/** Fail closed for invalid/old snapshots, including switching away and back to
 * the same site (revision differs). No stringification/key-order dependence. */
export function copilotContextMatches(
  expected: unknown,
  actual: unknown,
): boolean {
  const left = CopilotContextSchema.safeParse(expected);
  const right = CopilotContextSchema.safeParse(actual);
  if (!left.success || !right.success) return false;
  return (
    Object.keys(CopilotContextSchema.shape) as (keyof CopilotContext)[]
  ).every((key) => left.data[key] === right.data[key]);
}
