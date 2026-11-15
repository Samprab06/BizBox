/**
 * HAC-128: the workspace assistant talks to the existing intake agent
 * (POST /api/projects/[projectId]/intake) and keeps its history in the existing intake
 * session (localStorage `sitework:intake:v1:<projectId>`, read by IntakeScreen, the context
 * bar and the site search). There is no second conversation or profile store.
 *
 * HAC-129: this is the one implementation of the request/merge steps. The workspace hook and
 * the intake screen's detailed form (IntakeForm.sendLive) both call these functions, so the
 * body shape, error handling and the in-flight-edit merge cannot drift apart. The surfaces
 * only differ in their wording (`IntakeCopy`) and in whether a reply carries chat text.
 */
import {
  formFromDraft,
  IntakeResponseSchema,
  patchFromForm,
  type IntakeResponse,
} from "@/components/intake/live";
import {
  fields,
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

/**
 * The body both surfaces send: round-tripped state, pending form edits and the message. The
 * message is omitted for a form-only sync of committed edits.
 */
export function intakeRequestBody(session: IntakeSession, text?: string) {
  // Offline onboarding saves the profile without creating pending API edits.
  // Every message carries the latest founder answers so an absent or older
  // live draft cannot make the assistant ask for those answers again.
  // Form-only sync retains the existing pending-edit protocol.
  const keys =
    text === undefined
      ? (session.pending ?? [])
      : fields.map((field) => field.key);
  return {
    state: session.live?.state,
    patch: patchFromForm(session.profile, keys),
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

/** Surface-specific wording for the three ways a request can fail. */
export type IntakeCopy = {
  unreachable: string;
  unavailable: string;
  unexpected: string;
};

export const assistantCopy: IntakeCopy = {
  unreachable: "Could not reach the BizBox assistant. Please try again.",
  unavailable:
    "The BizBox assistant is temporarily unavailable. Please try again.",
  unexpected:
    "The BizBox assistant sent an unexpected reply. Please try again.",
};

export async function postIntakeMessage(
  fetchImpl: typeof fetch,
  projectId: string,
  body: ReturnType<typeof intakeRequestBody>,
  copy: IntakeCopy = assistantCopy,
): Promise<IntakeOutcome> {
  let response: Response;
  try {
    response = await fetchImpl(intakeEndpoint(projectId), {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
  } catch {
    return { ok: false, message: copy.unreachable, retryable: true };
  }
  const json: unknown = await response.json().catch(() => null);
  if (!response.ok) {
    const error = json as { message?: unknown } | null;
    return {
      ok: false,
      message:
        typeof error?.message === "string" ? error.message : copy.unavailable,
      retryable: response.status >= 500,
    };
  }
  const parsed = IntakeResponseSchema.safeParse(json);
  if (!parsed.success)
    return { ok: false, message: copy.unexpected, retryable: true };
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
  /** False for a form-only sync (no founder message), which has no chat reply to show. */
  appendReply = true,
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
    messages: appendReply
      ? [...now.messages, { role: "agent", text: result.assistantMessage }]
      : now.messages,
  };
}

/** The newest saved session, or the intake's starting session when none is saved. */
export function sessionOrInitial(raw: string | null): IntakeSession {
  return parseIntakeSession(raw) ?? initialSession;
}
