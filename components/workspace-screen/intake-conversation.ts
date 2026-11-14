/**
 * HAC-128: the workspace assistant talks to the existing intake agent
 * (POST /api/projects/[projectId]/intake) and keeps its history in the existing intake
 * session (localStorage `sitework:intake:v1:<projectId>`, read by IntakeScreen, the context
 * bar and the site search). There is no second conversation or profile store.
 *
 * The request/merge steps mirror IntakeForm.sendLive in components/intake/intake-screen.tsx
 * and reuse its mapping helpers from components/intake/live.ts.
 */
import {
  formFromDraft,
  IntakeResponseSchema,
  patchFromForm,
  type IntakeResponse,
} from "@/components/intake/live";
import {
  initialSession,
  intakeSessionSchema,
  type IntakeSession,
} from "@/components/intake/profile";

export const intakeStorageKey = (projectId: string) =>
  `sitework:intake:v1:${projectId}`;

export const intakeEndpoint = (projectId: string) =>
  `/api/projects/${encodeURIComponent(projectId)}/intake`;

/** The saved session, or `null` when none is saved or it cannot be read. */
export function parseIntakeSession(raw: string | null): IntakeSession | null {
  if (!raw) return null;
  try {
    return intakeSessionSchema.parse(JSON.parse(raw));
  } catch {
    return null;
  }
}

/** The same body IntakeForm sends: round-tripped state, pending form edits and the message. */
export function intakeRequestBody(session: IntakeSession, text: string) {
  return {
    state: session.live?.state,
    patch: patchFromForm(session.profile, session.pending ?? []),
    message: text,
  };
}

export function withFounderMessage(
  session: IntakeSession,
  text: string,
): IntakeSession {
  return {
    ...session,
    messages: [...session.messages, { role: "founder", text }],
  };
}

export type IntakeOutcome =
  | { ok: true; result: IntakeResponse }
  | { ok: false; message: string; retryable: boolean };

export async function postIntakeMessage(
  fetchImpl: typeof fetch,
  projectId: string,
  body: ReturnType<typeof intakeRequestBody>,
): Promise<IntakeOutcome> {
  let response: Response;
  try {
    response = await fetchImpl(intakeEndpoint(projectId), {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
  } catch {
    return {
      ok: false,
      message: "Could not reach the BizBox assistant. Please try again.",
      retryable: true,
    };
  }
  const json: unknown = await response.json().catch(() => null);
  if (!response.ok) {
    const error = json as { message?: unknown } | null;
    return {
      ok: false,
      message:
        typeof error?.message === "string"
          ? error.message
          : "The BizBox assistant is temporarily unavailable. Please try again.",
      retryable: response.status >= 500,
    };
  }
  const parsed = IntakeResponseSchema.safeParse(json);
  if (!parsed.success)
    return {
      ok: false,
      message:
        "The BizBox assistant sent an unexpected reply. Please try again.",
      retryable: true,
    };
  return { ok: true, result: parsed.data };
}

/**
 * Applies a reply to the newest saved session. Form edits made elsewhere while the request was
 * in flight stay newer than the reply, exactly as in IntakeForm.
 */
export function applyIntakeReply(
  now: IntakeSession,
  sent: IntakeSession,
  result: IntakeResponse,
): IntakeSession {
  const sentKeys = new Set(sent.pending ?? []);
  const stillPending = (now.pending ?? []).filter(
    (key) =>
      !sentKeys.has(key) ||
      now.profile[key]?.value !== sent.profile[key]?.value,
  );
  const profile = { ...now.profile };
  for (const [key, answer] of Object.entries(formFromDraft(result.draft)) as [
    keyof IntakeSession["profile"],
    { value: string; origin: "default" | "founder" },
  ][]) {
    if (!stillPending.includes(key)) profile[key] = answer;
  }
  return {
    ...now,
    profile,
    pending: stillPending,
    live: {
      state: { draft: result.draft, assumptions: result.assumptions },
      missingRequiredFields: result.missingRequiredFields,
      findings: result.findings,
    },
    messages: [
      ...now.messages,
      { role: "agent", text: result.assistantMessage },
    ],
  };
}

/** The newest saved session, or the intake's starting session when none is saved. */
export function sessionOrInitial(raw: string | null): IntakeSession {
  return parseIntakeSession(raw) ?? initialSession;
}
