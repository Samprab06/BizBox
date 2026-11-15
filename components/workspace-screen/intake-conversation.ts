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
  mustHaves,
  profileFromIntake,
} from "@/lib/client/intake-business-profile";
import { IntakeDraftSchema, type IntakeState } from "@/lib/contracts/intake";
import type { AgentViewContext } from "@/lib/contracts/agent";
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

/** Keep every explicit live leaf, including null/unknown; fill only absent form-derived data. */
function fillMissing(current: unknown, fallback: unknown): unknown {
  if (current === undefined) return fallback;
  if (
    current === null ||
    fallback === null ||
    typeof current !== "object" ||
    typeof fallback !== "object" ||
    Array.isArray(current) ||
    Array.isArray(fallback)
  )
    return current;
  const existing = current as Record<string, unknown>;
  return Object.fromEntries(
    [...new Set([...Object.keys(fallback), ...Object.keys(existing)])].map(
      (key) => [
        key,
        fillMissing(existing[key], (fallback as Record<string, unknown>)[key]),
      ],
    ),
  );
}

function currentViewState(
  session: IntakeSession,
  projectId: string,
): IntakeState | undefined {
  const { profile } = profileFromIntake(session, projectId);
  if (!profile) return session.live?.state;
  const searchDraft = Object.fromEntries(
    Object.entries(profile).filter(([key]) => key in IntakeDraftSchema.shape),
  );
  const draft = IntakeDraftSchema.safeParse(
    fillMissing(session.live?.state.draft, searchDraft),
  );
  // Partial live constraints can conflict with older completed form values (e.g. hours).
  // Keep the valid original state so sending a turn never fails during serialization.
  if (!draft.success) return session.live?.state;
  return {
    draft: draft.data,
    assumptions: session.live?.state.assumptions ?? {},
  };
}

/**
 * Both surfaces send the existing state/patch/message contract and the active screen.
 * A completed browser form seeds missing state only when selected-site context needs it.
 */
export function intakeRequestBody(
  session: IntakeSession,
  text?: string,
  view?: AgentViewContext,
  projectId?: string,
) {
  // Offline onboarding saves the profile without creating pending API edits.
  // Every message carries the latest founder answers so an absent or older
  // live draft cannot make the assistant ask for those answers again.
  // Form-only sync retains the existing pending-edit protocol.
  const keys =
    text === undefined
      ? (session.pending ?? [])
      : fields.map((field) => field.key);
  return {
    state:
      text && projectId && (view?.siteId || view?.candidateIds?.length)
        ? currentViewState(session, projectId)
        : session.live?.state,
    patch: patchFromForm(session.profile, keys),
    message: text,
    ...(view ? { view } : {}),
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

/** A successful outcome carries the reply UI actions (HAC-144). */
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
    if (stillPending.includes(key)) continue;
    if (key === "requirements" && profile.requirements?.origin === "founder") {
      // Flags are a search projection, not a replacement for the founder's sentence.
      // A form-only acknowledgement cannot add free text. Chat can change the flags,
      // but unchanged values (including provenance-only updates) keep the original wording.
      // A chat request may also carry a pending form edit. Compare against the
      // flags actually sent in that patch, rather than the older live snapshot.
      const previous =
        sentKeys.has("requirements") && sent.profile.requirements
          ? mustHaves(sent.profile.requirements)
          : (sent.live?.state.draft.mustHaves ??
            mustHaves(profile.requirements));
      const returned = result.draft.mustHaves;
      const unchanged = (
        ["frontage", "corner", "parking", "groundFloor"] as const
      ).every(
        (feature) => previous[feature]?.value === returned?.[feature]?.value,
      );
      if (!appendReply || unchanged) continue;
    }
    profile[key] = answer;
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
