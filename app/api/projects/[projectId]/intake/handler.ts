import { randomUUID } from "node:crypto";
import { z } from "zod";
import {
  UiActionListSchema,
  type UiAction,
  type AgentViewContext,
} from "@/lib/contracts/agent";
import { IntakeRequestSchema } from "@/lib/contracts/intake";
import { createIntakeSession } from "@/lib/agent/intake";
import {
  INTAKE_TIMEOUT_MS,
  loadIntakeRunner,
  ModelRuntimeUnavailableError,
  type IntakeRunner,
} from "@/lib/agent/runtime-loader";
import { ruleBasedUiActions, type IntakeUiLookups } from "@/lib/agent/ui-tools";
import type { JobsPort } from "@/lib/agent/job-tools";
import {
  fallbackFlowEventTurn,
  type ComparisonResultsPort,
} from "@/lib/agent/flow-tools";
import {
  formatViewContext,
  resolveViewContext,
  InvalidViewReferenceError,
  type ViewContextLookups,
} from "@/lib/agent/view-context";

const MAX_BODY_BYTES = 64 * 1024;
const projectIdSchema = z.string().trim().min(1).max(200);
type Context = { params: Promise<{ projectId: string }> };
type Dependencies = {
  projectExists: (projectId: string) => Promise<boolean>;
  runAgent?: IntakeRunner;
  viewContextLookups?: ViewContextLookups;
  /** HAC-144: trusted ID checks for the UI tools. Without them no UI tools are bound. */
  uiLookups?: IntakeUiLookups;
  /** HAC-151: server ports for the `jobs` tools (shortlist, comparison, investigation, plan). */
  jobs?: JobsPort;
  /** Scene 1: reads the project's stored comparisons (read_comparison_results, finalize_plan). */
  comparisonResults?: ComparisonResultsPort;
  /** Scene 1: whether a model is configured; defaults to OPENAI_API_KEY being set. */
  modelConfigured?: () => boolean;
  newActionId?: () => string;
  onCompleted?: (
    projectId: string,
    input: z.infer<typeof IntakeRequestSchema>,
    reply: string,
    draft: unknown,
  ) => Promise<void>;
};
const json = (body: unknown, status: number) =>
  Response.json(body, { status, headers: { "Cache-Control": "no-store" } });
const unavailable = () =>
  json(
    {
      code: "INTAKE_UNAVAILABLE",
      message: "Intake is temporarily unavailable. Please try again.",
      field_errors: {},
    },
    503,
  );
/** The 503 for a failed founder-message turn. */
function turnFailed(error: unknown) {
  if (error instanceof ModelRuntimeUnavailableError)
    return json(
      {
        code: "MODEL_RUNTIME_UNAVAILABLE",
        message:
          "The intake model runtime could not load. Structured profile edits still work.",
        field_errors: {},
        detail: error.detail,
      },
      503,
    );
  // Operator diagnostic from enumerated fields only (class, HTTP status, provider
  // error code); never the provider's message text.
  const e = (error ?? {}) as {
    name?: unknown;
    status?: unknown;
    code?: unknown;
  };
  const detail = [
    typeof e.name === "string" && /^[A-Za-z]{1,40}$/.test(e.name)
      ? e.name
      : "Error",
    typeof e.status === "number" ? `HTTP ${e.status}` : null,
    typeof e.code === "string" && /^[a-z_]{3,40}$/.test(e.code) ? e.code : null,
  ]
    .filter(Boolean)
    .join(" ");
  return json(
    {
      code: "INTAKE_UNAVAILABLE",
      message: "Intake is temporarily unavailable. Please try again.",
      field_errors: {},
      detail,
    },
    503,
  );
}
/** A credential- and content-free tag for a failed thread append (e.g. "42P01"). */
function threadErrorTag(error: unknown): string {
  if (error && typeof error === "object") {
    const code = (error as { code?: unknown }).code;
    if (typeof code === "string" && /^[A-Za-z0-9_]{1,40}$/.test(code))
      return code;
    const cause = (error as { cause?: { code?: unknown } }).cause;
    if (
      cause &&
      typeof cause.code === "string" &&
      /^[A-Za-z0-9_]{1,40}$/.test(cause.code)
    )
      return cause.code;
  }
  return error instanceof Error ? error.name.slice(0, 60) : "unknown";
}
function invalid(error: unknown) {
  const field_errors: Record<string, string[]> = {};
  if (error instanceof z.ZodError) {
    for (const issue of error.issues) {
      const field = issue.path.join(".") || "_request";
      field_errors[field] = ["Invalid intake value"];
    }
  } else field_errors._request = ["Invalid intake request"];
  return json(
    {
      code: "INVALID_INTAKE",
      message: "Provide valid intake values for this project.",
      field_errors,
    },
    422,
  );
}

async function readBody(request: Request): Promise<unknown> {
  if (!request.body) throw new Error("Missing body");
  const reader = request.body.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > MAX_BODY_BYTES) {
        await reader.cancel();
        throw new Error("Request too large");
      }
      chunks.push(value);
    }
  } finally {
    reader.releaseLock();
  }
  const bytes = new Uint8Array(size);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes));
}

export function createIntakeHandler(dependencies: Dependencies) {
  return async function POST(request: Request, context: Context) {
    let input: z.infer<typeof IntakeRequestSchema>;
    let projectId: string;
    try {
      projectId = projectIdSchema.parse((await context.params).projectId);
      input = IntakeRequestSchema.parse(await readBody(request));
    } catch (error) {
      return invalid(error);
    }
    try {
      if (!(await dependencies.projectExists(projectId)))
        return json(
          {
            code: "PROJECT_NOT_FOUND",
            message: "Project not found.",
            field_errors: {},
          },
          404,
        );
    } catch {
      return unavailable();
    }
    let session;
    let wasComplete: boolean;
    try {
      session = createIntakeSession(projectId, input.state);
      wasComplete = session.snapshot().profile !== null;
      if (input.patch) session.saveProfile(input.patch);
    } catch (error) {
      return invalid(error);
    }
    let validatedView: AgentViewContext | undefined;
    let assistantMessage =
      session.snapshot().nextQuestion?.question ??
      "Review your profile, assumptions, and findings.";
    const newId = dependencies.newActionId ?? (() => `ui_${randomUUID()}`);
    // The per-turn collector the UI tools push to; kept when the step budget runs out.
    const actions: UiAction[] = [];
    // Scene 1: a browser event (no founder message) is a consultant turn of its own. With a
    // model it runs the agent; without one, or when the agent fails or stays silent, it gets
    // a deterministic reply, so the guided flow keeps working offline.
    const event = input.message ? undefined : input.event;
    const modelConfigured =
      dependencies.modelConfigured ??
      (() => Boolean(process.env.OPENAI_API_KEY?.trim()));
    const eventUsesModel = Boolean(
      event && (dependencies.runAgent || modelConfigured()),
    );
    let eventNeedsFallback = Boolean(event && !eventUsesModel);
    if (input.message || eventUsesModel) {
      const controller = new AbortController();
      const signal = AbortSignal.any([request.signal, controller.signal]);
      let onAbort: (() => void) | undefined;
      const timeout = setTimeout(() => controller.abort(), INTAKE_TIMEOUT_MS);
      try {
        // Register cancellation before starting the runner; an already-aborted
        // signal does not emit another event to a newly added listener.
        signal.throwIfAborted();
        const aborted = new Promise<never>((_, reject) => {
          onAbort = () => reject(new Error("Intake deadline exceeded"));
          signal.addEventListener("abort", onAbort, { once: true });
        });
        const runTurn = async () => {
          const view = await resolveViewContext(
            projectId,
            input.view,
            dependencies.viewContextLookups,
            session.snapshot().profile,
          );
          signal.throwIfAborted();
          validatedView = view;
          const viewContextLine = view ? formatViewContext(view) : undefined;
          const runAgent = dependencies.runAgent ?? (await loadIntakeRunner());
          signal.throwIfAborted();
          return runAgent({
            session,
            message: input.message ?? "",
            ...(event ? { event } : {}),
            signal,
            viewContextLine,
            ...(dependencies.uiLookups
              ? {
                  ui: {
                    projectId,
                    lookups: dependencies.uiLookups,
                    view,
                    ...(dependencies.jobs ? { jobs: dependencies.jobs } : {}),
                    ...(dependencies.comparisonResults
                      ? { results: dependencies.comparisonResults }
                      : {}),
                    actions,
                    newId,
                  },
                }
              : {}),
          });
        };
        const reply = await Promise.race([runTurn(), aborted]);
        if (event && !reply.trim()) eventNeedsFallback = true;
        else assistantMessage = reply;
      } catch (error) {
        if (error instanceof InvalidViewReferenceError) return invalid(error);
        if (event) {
          // A failed event turn never surfaces as an error; the flow carries on.
          console.warn(
            `[intake] flow event ${event.kind} used the fallback reply: ${threadErrorTag(error)}`,
          );
          actions.length = 0;
          eventNeedsFallback = true;
        } else return turnFailed(error);
      } finally {
        clearTimeout(timeout);
        if (onAbort) signal.removeEventListener("abort", onAbort);
      }
    }
    if (event && eventNeedsFallback) {
      let view = validatedView;
      if (!view && input.view !== undefined) {
        try {
          view = await resolveViewContext(
            projectId,
            input.view,
            dependencies.viewContextLookups,
            session.snapshot().profile,
          );
          validatedView = view;
        } catch (error) {
          if (error instanceof InvalidViewReferenceError) return invalid(error);
          view = undefined;
        }
      }
      const fallback = await fallbackFlowEventTurn({
        event,
        view,
        projectId,
        results: dependencies.comparisonResults,
        newId,
      });
      assistantMessage = fallback.reply;
      // Keep what a silent model already queued; otherwise use the event's own actions.
      if (!actions.length) actions.push(...fallback.actions);
    } else if (!input.message && !event) {
      // No model runs this turn: a rule moves a newly completed profile to the spaces.
      actions.push(
        ...ruleBasedUiActions({
          wasComplete,
          isComplete: session.snapshot().profile !== null,
          newId,
        }),
      );
    }
    if (dependencies.onCompleted) {
      try {
        const recordedInput = { ...input };
        delete recordedInput.view;
        if (validatedView) recordedInput.view = validatedView;
        await dependencies.onCompleted(
          projectId,
          recordedInput,
          assistantMessage,
          session.snapshot(),
        );
      } catch (error) {
        // Recording the exchange in the copilot thread is best-effort: a missing
        // table (migration 0008 not applied) or a failed write never changes the
        // intake response. Log one short line without any message text.
        console.warn(
          `[intake] copilot thread append skipped: ${threadErrorTag(error)}`,
        );
      }
    }
    return json(
      {
        ...session.snapshot(),
        assistantMessage,
        actions: UiActionListSchema.parse(actions),
      },
      200,
    );
  };
}
