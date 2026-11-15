/**
 * SDK-free entry points for routes. The agent SDKs (deepagents, @langchain/*) load only when
 * a model call is about to happen, so request validation, 404s and job reads never depend on
 * them (HAC-58). Import failures become a typed error that routes report as a 503.
 */
import type { FlowEvent } from "@/lib/contracts/agent";
import type { IntakeSession } from "./intake";
import type { IntakeUiContext } from "./ui-tools";

export const INTAKE_TIMEOUT_MS = 20_000;
export type IntakeRunner = (input: {
  session: IntakeSession;
  /** The founder's words. Empty on a browser-event turn. */
  message: string;
  /** Scene 1: a browser event to react to instead of a founder message. */
  event?: FlowEvent;
  /** Scene 1: earlier turns, oldest first, excluding `message`. Untrusted browser text. */
  history?: readonly { role: "founder" | "agent"; text: string }[];
  signal: AbortSignal;
  /** Bounded line assembled only after server scope validation. */
  viewContextLine?: string;
  /** HAC-144: binds the UI tool group; the runner pushes queued actions to `ui.actions`. */
  ui?: IntakeUiContext;
}) => Promise<string>;

export class ModelRuntimeUnavailableError extends Error {
  constructor(readonly detail: string) {
    super("Model runtime unavailable");
    this.name = "ModelRuntimeUnavailableError";
  }
}

/** A short, credential-free description of a module-load failure (e.g. a missing file). */
export function describeLoadError(error: unknown): string {
  const raw =
    error instanceof Error ? `${error.name}: ${error.message}` : String(error);
  return raw
    .split("\n")[0]!
    .replace(/postgres(?:ql)?:\/\/\S+/gi, "<redacted-url>")
    .replace(/\b(?:sk|npg)[-_][A-Za-z0-9_-]{8,}/g, "<redacted>")
    .slice(0, 300);
}

async function loadOrThrow<T>(load: () => Promise<T>): Promise<T> {
  try {
    return await load();
  } catch (error) {
    throw new ModelRuntimeUnavailableError(describeLoadError(error));
  }
}

export function loadIntakeRunner(): Promise<IntakeRunner> {
  return loadOrThrow(
    async () => (await import("./runner")).runConfiguredIntakeAgent,
  );
}

export function loadInvestigationPlannerModule() {
  return loadOrThrow(() => import("./investigation-planner"));
}
