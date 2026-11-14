/**
 * SDK-free entry points for routes. The agent SDKs (deepagents, @langchain/*) load only when
 * a model call is about to happen, so request validation, 404s and job reads never depend on
 * them (HAC-58). Import failures become a typed error that routes report as a 503.
 */
import type { IntakeSession } from "./intake";

export const INTAKE_TIMEOUT_MS = 20_000;
export type IntakeRunner = (input: {
  session: IntakeSession;
  message: string;
  signal: AbortSignal;
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

export function loadCopilotModelModule() {
  return loadOrThrow(() => import("./copilot-model"));
}
