import "server-only";
import { randomUUID } from "node:crypto";
import { and, eq } from "drizzle-orm";
import { z } from "zod";
import { getDb } from "@/lib/db/client";
import { profiles, projects } from "@/lib/db/schema";
import {
  CopilotAdvanceRequestSchema,
  CopilotContextSchema,
  CopilotEventSchema,
  CopilotTurnRequestSchema,
  copilotContextMatches,
  type CopilotContext,
  type CopilotEvent,
  type CopilotProposal,
  type CopilotSourceLabel,
} from "@/lib/contracts/copilot-runtime";
import { createPostgresScenarioRepository } from "@/lib/scenario/repository";
import { createPostgresScenarioRunner } from "@/lib/scenario/runtime";
import { createPostgresCopilotTools } from "./copilot-tools-postgres";
import { createCopilotInvestigationReads } from "./copilot-investigation-tools";
import type { CopilotDecisionModel } from "./copilot-model";
import { loadCopilotModelModule } from "./runtime-loader";
import { guardCopilotDecision, groundedNumbers } from "./guards";
import {
  createPostgresThreadStore,
  type ThreadSnapshot,
  type ThreadStore,
  type ThreadMutation,
  type StoredToolCall,
} from "./thread-store";

function createPostgresConsultantTools() {
  const business = createPostgresCopilotTools();
  const investigation = createCopilotInvestigationReads();
  return {
    definitions: [...business.definitions, ...investigation.definitions],
    execute(
      name: string,
      args: unknown,
      context: Parameters<typeof business.execute>[2],
    ) {
      if (name === "get_catchment" || name === "read_nessie_cash_buffer")
        return investigation.execute(name, args, context);
      return business.execute(
        name as Parameters<typeof business.execute>[0],
        args,
        context,
      );
    },
  };
}
type Registry = ReturnType<typeof createPostgresConsultantTools>;
type EventInput = CopilotEvent extends infer E
  ? E extends CopilotEvent
    ? Omit<E, "threadId" | "turnId" | "sequence" | "context">
    : never
  : never;
const WALL_MS = 24_000;
const MAX_TOOLS = 8;
const MODEL_COST_MICROUSD = 2_000;
type Checkpoint = {
  requestId: string;
  message: string;
  context: CopilotContext;
  findings: string[];
  mode: string;
  runConfirmed: boolean;
  budgetConfirmed: boolean;
  approvedScenarioId?: string;
  leaseUntil: number;
};

function checkpoint(value: Record<string, unknown> | null): Checkpoint | null {
  if (!value) return null;
  return z
    .object({
      requestId: z.string(),
      message: z.string(),
      context: CopilotContextSchema,
      findings: z.array(z.string()),
      mode: z.string(),
      runConfirmed: z.boolean(),
      budgetConfirmed: z.boolean(),
      approvedScenarioId: z.string().optional(),
      leaseUntil: z.number().finite(),
    })
    .parse(value);
}

function proposals(state: ThreadSnapshot): CopilotProposal[] {
  return state.messages.flatMap((entry) => {
    const proposal = entry.metadata?.proposal;
    const parsed = z
      .object({
        id: z.string(),
        baseScenarioId: z.string(),
        proposedScenarioId: z.string().optional(),
        title: z.string(),
        description: z.string(),
        status: z.enum(["pending", "run_requested", "kept", "reverted"]),
        evidenceIds: z.array(z.string()),
      })
      .safeParse(proposal);
    return parsed.success ? [parsed.data] : [];
  });
}

function scopedError(message: string) {
  return new Error(message);
}

function sourceLabels(tool: string, result: unknown): CopilotSourceLabel[] {
  if (
    !result ||
    typeof result !== "object" ||
    !("status" in result) ||
    result.status === "rejected" ||
    result.status === "unsupported"
  )
    return [];
  if (tool === "read_nessie_cash_buffer")
    return [
      {
        kind: "modeled",
        label: "Nessie simulated demo banking; not a real founder account",
        evidenceIds: [],
      },
    ];
  if (tool === "get_catchment")
    return [
      {
        kind: "modeled",
        label:
          "Catchment includes public and modeled inputs; inspect source evidence before citing a value",
        evidenceIds: [],
      },
    ];
  if (tool === "run_scenario")
    return [
      {
        kind: "modeled",
        label:
          "Existing scenario engine; Jev or fallback demand source is recorded on the saved comparison",
        evidenceIds: [],
      },
    ];
  if (tool === "diagnose" && "demandSource" in result)
    return [
      {
        kind: "modeled",
        label:
          "Bottleneck diagnosis of saved representative runs with fixed thresholds; experiments are proposals, not forecasts",
        evidenceIds: [],
      },
      result.demandSource === "jev"
        ? {
            kind: "jev",
            label: "Demand from cached Jev customer-panel answers",
            evidenceIds: [],
          }
        : {
            kind: "fallback",
            label: "Demand from the Huff fallback model, not Jev panel answers",
            evidenceIds: [],
          },
    ];
  if (tool === "find_sites")
    return [
      {
        kind: "modeled",
        label:
          "Site search references include listing evidence; inspect each saved evidence ID before citing it",
        evidenceIds: [],
      },
    ];
  return [
    {
      kind: "modeled",
      label:
        "Saved scenario or comparison result; inspect its evidence references",
      evidenceIds: [],
    },
  ];
}

export type CopilotRuntimeDependencies = {
  store: ThreadStore;
  tools: Registry;
  choose: CopilotDecisionModel;
  validateContext: (
    context: CopilotContext,
    signal: AbortSignal,
  ) => Promise<void>;
  now?: () => number;
  newId?: () => string;
  wallMs?: number;
  maxTools?: number;
  modelCostMicrousd?: number;
};

/** One durable project conversation. Only persisted, scoped events are emitted. */
export function createCopilotRuntime({
  store,
  tools,
  choose,
  validateContext,
  now = Date.now,
  newId = randomUUID,
  wallMs = WALL_MS,
  maxTools = MAX_TOOLS,
  modelCostMicrousd = MODEL_COST_MICROUSD,
}: CopilotRuntimeDependencies) {
  async function save(
    state: ThreadSnapshot,
    mutation: Omit<ThreadMutation, "idempotencyKey">,
    key: string,
  ) {
    return store.commit(state.projectId, state.revision, {
      ...mutation,
      idempotencyKey: key,
    });
  }

  async function emit(
    state: ThreadSnapshot,
    turnId: string,
    context: CopilotContext,
    event: EventInput,
    key: string,
    mutation: Omit<ThreadMutation, "idempotencyKey" | "events"> = {},
  ): Promise<{ state: ThreadSnapshot; event: CopilotEvent }> {
    const complete = CopilotEventSchema.parse({
      threadId: state.projectId,
      turnId,
      sequence: state.nextEventSeq,
      context,
      ...event,
    });
    const next = await save(
      state,
      {
        ...mutation,
        events: [{ type: complete.type, payload: z.json().parse(complete) }],
      },
      key,
    );
    return { state: next, event: complete };
  }

  async function* drive(
    initial: ThreadSnapshot,
    signal: AbortSignal,
  ): AsyncGenerator<CopilotEvent> {
    let state = initial;
    const turn = state.turn;
    const data = checkpoint(state.checkpoint);
    if (!turn || !data) throw scopedError("No pending turn");
    const { context } = data;
    const started = now();
    let counter = 0;
    while (true) {
      signal.throwIfAborted();
      // Each model step is bounded independently. Work already committed is never rerun.
      const completed = state.toolCalls.filter(
        (call) => call.turnId === turn.id && call.status === "completed",
      );
      const pending = state.toolCalls.find(
        (call) =>
          call.turnId === turn.id &&
          call.status !== "completed" &&
          call.status !== "failed",
      );
      const limit =
        now() - started >= wallMs
          ? "wall_time"
          : completed.length >= maxTools
            ? "tool_calls"
            : state.costMicrousd + modelCostMicrousd > state.costCapMicrousd
              ? "project_cost"
              : null;
      if (limit && !pending) {
        const message =
          limit === "project_cost"
            ? "Project model cost cap reached. Here are the findings so far; no additional model calls will be made."
            : limit === "tool_calls"
              ? "Tool-call limit reached. Findings so far are saved; continue this turn to work on the remaining items."
              : "Time slice ended. Findings so far are saved; continue this turn without repeating completed work.";
        let emitted = await emit(
          state,
          turn.id,
          context,
          {
            type: "limit",
            reason: limit,
            message,
            resumable: limit !== "project_cost",
          },
          `${turn.id}:limit:${state.revision}`,
          {
            turn: {
              ...turn,
              status: limit === "project_cost" ? "limited" : "interrupted",
              findings: data.findings,
              reason: limit,
            },
          },
        );
        state = emitted.state;
        yield emitted.event;
        emitted = await emit(
          state,
          turn.id,
          context,
          {
            type: "turn_finished",
            status: limit === "project_cost" ? "completed" : "paused",
            message,
          },
          `${turn.id}:limit-finished:${state.revision}`,
        );
        yield emitted.event;
        return;
      }
      if (!pending) {
        let decision;
        try {
          decision = await choose({
            mode: data.mode,
            context,
            signal,
            history: state.messages.map(({ role, content }) => ({
              role,
              content,
            })),
            completedToolCalls: completed.map((call) => ({
              tool: call.name,
              args: call.input as Record<string, unknown>,
              output: call.output,
            })),
            tools: tools.definitions.map((definition) => ({
              name: definition.name,
              description: definition.description,
              schema: definition.schema,
            })),
          });
        } catch (error) {
          if (
            error instanceof Error &&
            error.message === "Intake model is not configured"
          ) {
            const emitted = await emit(
              state,
              turn.id,
              context,
              {
                type: "error",
                code: "NOT_CONFIGURED",
                message: "Intake model is not configured",
              },
              `${turn.id}:not-configured:${state.revision}`,
              {
                turn: { ...turn, status: "failed", reason: "not_configured" },
                checkpoint: null,
              },
            );
            yield emitted.event;
            return;
          }
          throw error;
        }
        // Estimate a conservative fixed charge per decision; never let a model bypass the project ledger.
        state = await save(
          state,
          { costMicrousd: modelCostMicrousd },
          `${turn.id}:model:${state.revision}`,
        );
        // HAC-91: model prose may only repeat numbers it was given by the founder,
        // the workspace clock or completed tool calls. Others are stripped and flagged.
        const guarded = guardCopilotDecision(
          decision,
          groundedNumbers([
            data.message,
            ...state.messages
              .filter((entry) => entry.role === "user")
              .map((entry) => entry.content),
            { minute: context.minute },
            ...completed.map((call) => ({
              input: call.input,
              output: call.output,
            })),
          ]),
        );
        const removedNumbers = guarded.removed;
        decision = {
          ...decision,
          reply: guarded.reply,
          findings: guarded.findings,
        };
        data.findings = [
          ...new Set([...data.findings, ...decision.findings]),
        ].slice(0, 100);
        const todos = decision.todos.map((todo, index) => ({
          id: `${turn.id}:todo:${index}`,
          ...todo,
        }));
        let emitted = await emit(
          state,
          turn.id,
          context,
          { type: "todos", todos },
          `${turn.id}:todos:${state.revision}`,
          { todos, checkpoint: data },
        );
        state = emitted.state;
        yield emitted.event;
        if (decision.reply) {
          emitted = await emit(
            state,
            turn.id,
            context,
            { type: "assistant_delta", text: decision.reply, sources: [] },
            `${turn.id}:reply:${state.revision}`,
            {
              messages: [
                {
                  id: `${turn.id}:reply:${counter++}`,
                  role: "assistant",
                  content: decision.reply,
                  turnId: turn.id,
                  ...(removedNumbers.length
                    ? { metadata: { numberGuard: { removed: removedNumbers } } }
                    : {}),
                },
              ],
            },
          );
          state = emitted.state;
          yield emitted.event;
        }
        if (decision.tool === "finish") {
          const message =
            decision.reply ||
            data.findings.join("; ") ||
            "I have saved the findings so far.";
          emitted = await emit(
            state,
            turn.id,
            context,
            { type: "turn_finished", status: "completed", message },
            `${turn.id}:done:${state.revision}`,
            {
              turn: { ...turn, status: "completed", findings: data.findings },
              checkpoint: null,
            },
          );
          yield emitted.event;
          return;
        }
        const definition = tools.definitions.find(
          (item) => item.name === decision.tool,
        );
        if (!definition) throw scopedError("Unknown model-selected tool");
        const args = definition.schema.parse(JSON.parse(decision.argsJson));
        // A completed call with identical input is evidence, not another side effect.
        if (
          completed.some(
            (call) =>
              call.name === definition.name &&
              JSON.stringify(call.input) === JSON.stringify(args),
          )
        )
          throw scopedError("Completed tool call repeated");
        const call: StoredToolCall = {
          id: newId(),
          turnId: turn.id,
          name: definition.name,
          input: args,
          status: "pending",
        };
        emitted = await emit(
          state,
          turn.id,
          context,
          { type: "tool_started", callId: call.id, tool: call.name },
          `${turn.id}:tool-start:${call.id}`,
          {
            toolCalls: [call],
            checkpoint: data,
          },
        );
        state = emitted.state;
        yield emitted.event;
      }
      const call = state.toolCalls.find(
        (item) => item.turnId === turn.id && item.status === "pending",
      );
      if (!call) continue;
      // Only the explicitly approved Run action can set trusted confirmation flags.
      // The selected base remains the UI context; only this trusted action may
      // scope a Run to the persisted proposed child.
      const runScenarioId =
        call.name === "run_scenario" ? data.approvedScenarioId : undefined;
      if (
        call.name === "run_scenario" &&
        (!data.runConfirmed ||
          !runScenarioId ||
          (call.input as { scenario_id?: string }).scenario_id !==
            runScenarioId)
      ) {
        const emitted = await emit(
          state,
          turn.id,
          context,
          {
            type: "turn_finished",
            status: "completed",
            message:
              "Review the pending proposal and choose Run before starting its scenario.",
          },
          `${turn.id}:run-needs-approval:${call.id}`,
          {
            toolCalls: [
              { ...call, status: "failed", error: "human_run_required" },
            ],
            turn: { ...turn, status: "completed", findings: data.findings },
            checkpoint: null,
          },
        );
        yield emitted.event;
        return;
      }
      // A read of the approved child (the post-run diagnosis) is scoped to that child.
      const diagnosedScenarioId =
        call.name === "diagnose" &&
        data.runConfirmed &&
        data.approvedScenarioId &&
        (call.input as { scenario_id?: string }).scenario_id ===
          data.approvedScenarioId
          ? data.approvedScenarioId
          : undefined;
      const result = await tools.execute(call.name, call.input, {
        projectId: context.projectId,
        scenarioId: runScenarioId ?? diagnosedScenarioId ?? context.scenarioId,
        profileVersion: context.profileVersion,
        signal,
        evidenceId: `copilot:${turn.id}:${call.id}`,
        idempotencyKey: call.id,
        runConfirmed: data.runConfirmed,
        budgetConfirmed: data.budgetConfirmed,
      });
      signal.throwIfAborted();
      const updated = {
        ...call,
        status: "completed" as const,
        output: z.json().parse(JSON.parse(JSON.stringify(result))),
      };
      let emitted = await emit(
        state,
        turn.id,
        context,
        {
          type: "tool_completed",
          callId: call.id,
          tool: call.name,
          result,
          sources: sourceLabels(call.name, result),
        },
        `${turn.id}:tool-complete:${call.id}`,
        {
          toolCalls: [updated],
          turn: {
            ...turn,
            status: "running",
            findings: data.findings,
            toolCalls: completed.length + 1,
          },
        },
      );
      state = emitted.state;
      yield emitted.event;
      // HAC-89: every succeeded run is diagnosed next. The diagnosis is a read of the
      // saved comparison; it proposes experiments but never starts another run.
      if (
        call.name === "run_scenario" &&
        runScenarioId &&
        result &&
        typeof result === "object" &&
        "status" in result &&
        result.status === "succeeded" &&
        tools.definitions.some((definition) => definition.name === "diagnose")
      ) {
        const diagnosis: StoredToolCall = {
          id: `${call.id}:diagnose`,
          turnId: turn.id,
          name: "diagnose",
          input: { scenario_id: runScenarioId },
          status: "pending",
        };
        emitted = await emit(
          state,
          turn.id,
          context,
          { type: "tool_started", callId: diagnosis.id, tool: diagnosis.name },
          `${turn.id}:tool-start:${diagnosis.id}`,
          { toolCalls: [diagnosis], checkpoint: data },
        );
        state = emitted.state;
        yield emitted.event;
        continue;
      }
      if (
        result &&
        typeof result === "object" &&
        "status" in result &&
        result.status === "needs_confirmation"
      ) {
        const message =
          "Project budget confirmation is required before running this proposal. No simulation was started.";
        emitted = await emit(
          state,
          turn.id,
          context,
          { type: "turn_finished", status: "completed", message },
          `${turn.id}:budget-confirmation:${call.id}`,
          {
            turn: { ...turn, status: "completed", findings: data.findings },
            checkpoint: null,
          },
        );
        yield emitted.event;
        return;
      }
      if (
        result &&
        typeof result === "object" &&
        "status" in result &&
        result.status === "created" &&
        "scenarioId" in result &&
        typeof result.scenarioId === "string" &&
        context.scenarioId
      ) {
        const proposal: CopilotProposal = {
          id: call.id,
          baseScenarioId: context.scenarioId,
          proposedScenarioId: result.scenarioId,
          title: "Proposed change",
          description: `Review the ${call.name} change before running or keeping it.`,
          status: "pending",
          evidenceIds: [],
        };
        emitted = await emit(
          state,
          turn.id,
          context,
          { type: "proposal", proposal },
          `${turn.id}:proposal:${call.id}`,
          {
            messages: [
              {
                id: `proposal:${call.id}`,
                role: "assistant",
                content: proposal.description,
                turnId: turn.id,
                metadata: { proposal },
              },
            ],
          },
        );
        state = emitted.state;
        yield emitted.event;
      }
      // A checkpoint is persisted after every completed tool. No long model loop can
      // silently outrun the Vercel slice or duplicate its last completed call.
    }
  }

  return {
    async snapshot(projectId: string) {
      const state = await store.ensure(projectId);
      return {
        ...state,
        proposals: proposals(state),
        events: await store.events(projectId),
      };
    },
    async *start(
      projectId: string,
      raw: unknown,
      signal: AbortSignal,
    ): AsyncGenerator<CopilotEvent> {
      const input = CopilotTurnRequestSchema.parse(raw);
      if (input.context.projectId !== projectId)
        throw scopedError("Project context mismatch");
      await validateContext(input.context, signal);
      let state = await store.ensure(projectId);
      const existing = state.messages.find(
        (entry) => entry.metadata?.requestId === input.requestId,
      );
      if (existing) {
        for (const event of await store.events(projectId)) {
          if ((event.payload as CopilotEvent).turnId === existing.turnId)
            yield CopilotEventSchema.parse(event.payload);
        }
        return;
      }
      if (
        state.turn &&
        ["running", "interrupted", "pending"].includes(state.turn.status)
      )
        throw scopedError("Finish the current turn before starting another");
      if (
        state.turn?.context?.revision === input.context.revision &&
        !copilotContextMatches(state.turn.context, input.context)
      )
        throw scopedError("Workspace context changed without revision");
      let selected: CopilotProposal | undefined;
      if (input.proposalAction) {
        selected = proposals(state).find(
          (entry) =>
            entry.id === input.proposalAction!.proposalId &&
            (entry.status === "pending" ||
              (entry.status === "run_requested" &&
                input.proposalAction?.action === "run")),
        );
        if (
          !selected ||
          !input.context.scenarioId ||
          selected.baseScenarioId !== input.context.scenarioId
        )
          throw scopedError("Stale or unknown proposal");
        const proposal = {
          ...selected,
          status:
            input.proposalAction.action === "run"
              ? ("run_requested" as const)
              : input.proposalAction.action === "keep"
                ? ("kept" as const)
                : ("reverted" as const),
        };
        state = await save(
          state,
          {
            messages: [
              {
                id: `proposal:${selected.id}`,
                role: "assistant",
                content: proposal.description,
                metadata: { proposal },
              },
            ],
          },
          `proposal-action:${input.requestId}`,
        );
      }
      const turnId = newId();
      const data: Checkpoint = {
        requestId: input.requestId,
        message: input.message,
        context: input.context,
        findings: [],
        mode: /diagnos|plan/i.test(input.message) ? "diagnose" : "default",
        runConfirmed: input.proposalAction?.action === "run",
        budgetConfirmed:
          input.proposalAction?.action === "run" &&
          input.proposalAction.confirmBudget === true,
        approvedScenarioId:
          input.proposalAction?.action === "run"
            ? selected?.proposedScenarioId
            : undefined,
        leaseUntil: now() + wallMs + 20_000,
      };
      const emitted = await emit(
        state,
        turnId,
        input.context,
        { type: "turn_started", requestId: input.requestId },
        `${turnId}:start`,
        {
          messages: [
            {
              id: `user:${turnId}`,
              role: "user",
              content: input.message,
              turnId,
              metadata: { requestId: input.requestId },
            },
          ],
          turn: {
            id: turnId,
            status: "running",
            context: input.context,
            findings: [],
            toolCalls: 0,
            startedAt: new Date(now()).toISOString(),
          },
          checkpoint: data,
        },
      );
      yield emitted.event;
      yield* drive(emitted.state, signal);
    },
    async *advance(
      projectId: string,
      turnId: string,
      raw: unknown,
      signal: AbortSignal,
    ): AsyncGenerator<CopilotEvent> {
      const input = CopilotAdvanceRequestSchema.parse(raw);
      if (input.context.projectId !== projectId)
        throw scopedError("Project context mismatch");
      await validateContext(input.context, signal);
      let state = await store.ensure(projectId);
      if (
        !state.turn ||
        state.turn.id !== turnId ||
        !state.checkpoint ||
        !["running", "interrupted"].includes(state.turn.status)
      )
        throw scopedError("No resumable turn");
      if (
        !copilotContextMatches(
          checkpoint(state.checkpoint)?.context,
          input.context,
        )
      )
        throw scopedError("Stale workspace context");
      const data = checkpoint(state.checkpoint)!;
      if (state.turn.status === "running" && now() < data.leaseUntil)
        throw scopedError("Current turn is already being processed");
      state = await save(
        state,
        {
          turn: { ...state.turn, status: "running" },
          checkpoint: { ...data, leaseUntil: now() + wallMs + 20_000 },
        },
        `${turnId}:advance-claim:${newId()}`,
      );
      yield* drive(state, signal);
    },
  };
}

/** Scoped production validation, independent of model-authored arguments. */
export async function validatePostgresCopilotContext(
  context: CopilotContext,
  signal: AbortSignal,
) {
  const [project] = await getDb()
    .select({ id: projects.id })
    .from(projects)
    .where(eq(projects.id, context.projectId))
    .limit(1);
  if (!project) throw scopedError("Project not found");
  if (context.profileId || context.profileVersion) {
    if (!context.profileId || !context.profileVersion)
      throw scopedError("Profile identity requires version");
    const [profile] = await getDb()
      .select({ id: profiles.id })
      .from(profiles)
      .where(
        and(
          eq(profiles.projectId, context.projectId),
          eq(profiles.id, context.profileId),
          eq(profiles.version, context.profileVersion),
        ),
      )
      .limit(1);
    if (!profile) throw scopedError("Profile not found in project");
  }
  if (context.scenarioId) {
    const scenario = await createPostgresScenarioRepository().get(
      context.projectId,
      context.scenarioId,
    );
    if (
      !scenario ||
      (context.profileVersion &&
        scenario.profileVersion !== context.profileVersion) ||
      (context.siteId && !scenario.siteIds.includes(context.siteId))
    )
      throw scopedError("Scenario, site or profile context is stale");
    if (context.runId)
      await createPostgresScenarioRunner().get(
        context.projectId,
        context.scenarioId,
        context.runId,
      );
  } else if (context.runId) throw scopedError("Run needs a scoped scenario");
  signal.throwIfAborted();
}

/** The model SDKs load only when a decision is about to be made, so importing the
 * route, validation and 404s never depend on them. A missing key reports the same
 * "not configured" error as intake without loading the SDKs at all. */
export const lazyCopilotDecisionModel: CopilotDecisionModel = async (input) => {
  if (!process.env.OPENAI_API_KEY?.trim())
    throw new Error("Intake model is not configured");
  const { configuredCopilotDecisionModel } = await loadCopilotModelModule();
  return configuredCopilotDecisionModel(input);
};

export function createPostgresCopilotRuntime() {
  return createCopilotRuntime({
    store: createPostgresThreadStore(),
    tools: createPostgresConsultantTools(),
    choose: lazyCopilotDecisionModel,
    validateContext: validatePostgresCopilotContext,
  });
}
