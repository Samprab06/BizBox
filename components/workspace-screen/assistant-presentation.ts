import {
  initialSession,
  missingFields,
  type IntakeSession,
} from "@/components/intake/profile";

const INITIAL_OPENERS = new Set([
  initialSession.messages[0].text,
  "What kind of business are you opening?",
]);

/** A workspace-only projection. Never edits stored history or manufactures an agent reply. */
export function assistantPresentation(
  session: IntakeSession | null,
  messages: IntakeSession["messages"],
) {
  const complete = Boolean(
    session && missingFields(session.profile).length === 0,
  );
  if (!complete || !session)
    return { messages, context: null, placeholder: "Ask about your business…" };
  const visible = messages.filter(
    (entry, index) =>
      !(
        index === 0 &&
        entry.role === "agent" &&
        INITIAL_OPENERS.has(entry.text)
      ),
  );
  return {
    messages: visible,
    context: null,
    placeholder: "Ask about these locations…",
  };
}
