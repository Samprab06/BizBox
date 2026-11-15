"use client";

import {
  useEffect,
  useId,
  useRef,
  useState,
  type KeyboardEvent,
  type ReactNode,
} from "react";
import { Markdown } from "@/components/ui/markdown";
import { VoicePanel } from "@/components/voice/voice-panel";
import { VOICE_LIMITS, type VoiceAdapter } from "@/lib/voice/contracts";
import { assistantModes, nextAssistantMode, type AssistantMode } from "./model";
import { useAssistantDraft } from "./use-assistant-draft";
import type { IntakeConversation } from "./use-intake-conversation";

const MODE_LABEL: Record<AssistantMode, string> = {
  text: "Text",
  voice: "Voice",
};

function ChatIcon() {
  return (
    <svg
      viewBox="0 0 20 20"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.4"
      aria-hidden="true"
      className="size-4"
    >
      <path d="M16.5 9.5a6.5 6.5 0 0 1-6.5 6.5H4l-2 2V9.5a7.25 7.25 0 0 1 14.5 0Z" />
      <path d="M6 8h7M6 11h4" strokeLinecap="round" />
    </svg>
  );
}

function MicIcon() {
  return (
    <svg
      viewBox="0 0 20 20"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.4"
      aria-hidden="true"
      className="size-4"
    >
      <rect x="7" y="2" width="6" height="10" rx="3" />
      <path
        d="M4.5 9a5.5 5.5 0 0 0 11 0M10 14.5V18m-3 0h6"
        strokeLinecap="round"
      />
    </svg>
  );
}

const focusRing =
  "focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-viewport-ink";

function Conversation({
  conversation,
  id,
}: {
  conversation: IntakeConversation;
  id: string;
}) {
  const log = useRef<HTMLDivElement>(null);
  const count = conversation.messages.length;
  const pending = conversation.busy;
  useEffect(() => {
    const element = log.current;
    if (element) element.scrollTop = element.scrollHeight;
  }, [count, pending]);
  return (
    <div
      ref={log}
      id={id}
      role="log"
      aria-label="Conversation"
      tabIndex={0}
      className={`min-h-0 flex-1 overflow-y-auto px-5 py-4 text-sm ${focusRing}`}
    >
      {count === 0 ? (
        <p className="text-viewport-muted">
          Ask BizBox about this space or your brief. Replies come from the
          BizBox intake assistant.
        </p>
      ) : (
        <ol className="space-y-3">
          {conversation.messages.map((entry, index) => (
            <li
              key={index}
              className={
                entry.role === "founder"
                  ? "ml-8 rounded-2xl bg-viewport-ink px-3 py-2 text-viewport-canvas"
                  : "mr-6 text-viewport-ink"
              }
            >
              <span className="sr-only">
                {entry.role === "founder" ? "You: " : "BizBox: "}
              </span>
              {entry.role === "founder" ? (
                <span className="whitespace-pre-wrap break-words">{entry.text}</span>
              ) : (
                <Markdown text={entry.text} className="break-words" />
              )}
            </li>
          ))}
        </ol>
      )}
      <p
        aria-live="polite"
        data-testid="assistant-thinking"
        className="mr-6 mt-3 text-viewport-muted"
      >
        {pending && (
          <>
            <span className="thinking-dots" aria-hidden="true" />
            Thinking…
          </>
        )}
      </p>
    </div>
  );
}

/**
 * One assistant, two input modes. Text and Voice are WAI-ARIA tabs over the same conversation
 * hook and the same composer draft; switching modes only changes which input is shown.
 * HAC-143: the consultant shell owns the mode and the voice adapter, so both survive
 * navigation; the panel itself stays mounted in the project layout.
 */
export function AssistantPanel({
  projectId,
  conversation,
  mode,
  onModeChange,
  voiceAdapter,
  actions,
  inline,
  className = "",
}: {
  projectId: string;
  conversation: IntakeConversation;
  mode: AssistantMode;
  onModeChange: (mode: AssistantMode) => void;
  voiceAdapter: VoiceAdapter;
  /** Extra header controls (the shell's layout toggle). */
  actions?: ReactNode;
  /** HAC-150: an answer card shown in the Text tab between the conversation and the composer. */
  inline?: ReactNode;
  className?: string;
}) {
  const [draft, setDraft] = useAssistantDraft(projectId);
  const [historyOpen, setHistoryOpen] = useState(false);
  const field = useRef<HTMLTextAreaElement>(null);
  // Grow with the text up to the max-h-40 cap, and shrink back after a send.
  useEffect(() => {
    const element = field.current;
    if (!element) return;
    element.style.height = "auto";
    element.style.height = `${element.scrollHeight}px`;
  }, [draft, mode]);
  const tabs = useRef<Record<AssistantMode, HTMLButtonElement | null>>({
    text: null,
    voice: null,
  });
  const base = useId();
  const tabId = (value: AssistantMode) => `${base}-tab-${value}`;
  const panelId = (value: AssistantMode) => `${base}-panel-${value}`;
  const { availability, busy } = conversation;
  const offline = availability === "offline";

  const failure = conversation.failure?.source === "assistant" ? conversation.failure : null;

  function select(next: AssistantMode, focus: boolean) {
    onModeChange(next);
    if (focus) tabs.current[next]?.focus();
  }

  function onTabKey(event: KeyboardEvent<HTMLButtonElement>) {
    const next = nextAssistantMode(mode, event.key);
    if (!next) return;
    event.preventDefault();
    select(next, true);
  }

  const status =
    availability === "checking"
      ? "Checking"
      : availability === "live"
        ? "Live"
        : "Offline";

  return (
    <aside
      aria-labelledby={`${base}-heading`}
      className={`flex min-w-0 flex-col overflow-hidden rounded-3xl border border-viewport-line bg-viewport-canvas/95 text-viewport-ink ${className}`}
    >
      <header className="flex flex-wrap items-center justify-between gap-3 border-b border-viewport-line px-5 py-4">
        <div className="flex items-center gap-2">
          <h2
            id={`${base}-heading`}
            className="text-[15px] font-semibold tracking-tight"
          >
            Assistant
          </h2>
          <span
            data-agent-availability={availability}
            className="rounded border border-viewport-line px-1.5 py-0.5 text-[11px] text-viewport-muted"
          >
            {status}
          </span>
        </div>
        <div className="flex items-center gap-2">
        <div
          role="tablist"
          aria-label="Assistant mode"
          className="flex rounded-full border border-viewport-line p-1"
        >
          {assistantModes.map((value) => (
            <button
              key={value}
              ref={(element) => {
                tabs.current[value] = element;
              }}
              id={tabId(value)}
              type="button"
              role="tab"
              aria-selected={mode === value}
              aria-controls={panelId(value)}
              tabIndex={mode === value ? 0 : -1}
              onClick={() => select(value, false)}
              onKeyDown={onTabKey}
              className={`flex items-center gap-1.5 rounded-full px-3 py-1.5 text-xs font-medium ${focusRing} ${
                mode === value
                  ? "bg-viewport-ink text-viewport-canvas"
                  : "text-viewport-muted hover:text-viewport-ink"
              }`}
            >
              {value === "text" ? <ChatIcon /> : <MicIcon />}
              {MODE_LABEL[value]}
            </button>
          ))}
        </div>
        {actions}
        </div>
      </header>
      <p className="border-b border-viewport-line px-5 py-2 text-xs text-viewport-muted">
        Staffing changes and Keep/Revert are not connected yet.
      </p>

      {failure && (
        <div
          role="alert"
          className="mx-5 mt-3 rounded-xl border border-viewport-line bg-viewport-surface p-3 text-sm"
        >
          <p className="text-viewport-warn">{failure.message}</p>
          {failure.retry !== undefined && (
            <button
              type="button"
              disabled={busy}
              onClick={conversation.retry}
              className={`mt-2 rounded-lg border border-viewport-line px-3 py-1 text-viewport-ink disabled:opacity-60 ${focusRing}`}
            >
              Retry
            </button>
          )}
        </div>
      )}
      {conversation.storageError && (
        <p role="alert" className="mx-5 mt-3 text-sm text-viewport-warn">
          This browser could not save the conversation.
        </p>
      )}

      <div
        id={panelId("text")}
        role="tabpanel"
        aria-labelledby={tabId("text")}
        hidden={mode !== "text"}
        className="flex min-h-0 flex-1 flex-col"
      >
        {mode === "text" && (
          <>
            <Conversation conversation={conversation} id={`${base}-log-text`} />
            {inline}
            <form
              className="border-t border-viewport-line p-4"
              onSubmit={(event) => {
                event.preventDefault();
                const text = draft.trim();
                if (!text || busy) return;
                // Offline, nothing is sent and the draft stays for later.
                if (!offline) setDraft("");
                void conversation.submit(text);
              }}
            >
              <div className="flex items-end gap-2 rounded-2xl border border-viewport-line bg-viewport-surface p-1.5 pl-4 focus-within:outline-2 focus-within:outline-offset-2 focus-within:outline-viewport-ink">
                <textarea
                  ref={field}
                  rows={1}
                  aria-label="Message the BizBox assistant"
                  placeholder="Ask about this space…"
                  maxLength={VOICE_LIMITS.transcriptChars}
                  value={draft}
                  onChange={(event) => setDraft(event.target.value)}
                  onKeyDown={(event) => {
                    // Enter sends; Shift+Enter adds a line; never mid-IME-composition.
                    if (
                      event.key === "Enter" &&
                      !event.shiftKey &&
                      !event.nativeEvent.isComposing
                    ) {
                      event.preventDefault();
                      event.currentTarget.form?.requestSubmit();
                    }
                  }}
                  className="max-h-40 min-w-0 flex-1 resize-none bg-transparent py-2 text-sm text-viewport-ink placeholder:text-viewport-muted focus-visible:outline-none"
                />
                <button
                  type="submit"
                  disabled={busy || availability === "checking"}
                  aria-label={busy ? "Sending message" : "Send message"}
                  className={`grid size-9 shrink-0 place-items-center rounded-full bg-viewport-ink text-viewport-canvas disabled:opacity-60 ${focusRing}`}
                >
                  <svg
                    viewBox="0 0 20 20"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="1.6"
                    aria-hidden="true"
                    className="size-4"
                  >
                    <path
                      d="M10 15V5m-4 4 4-4 4 4"
                      strokeLinecap="round"
                      strokeLinejoin="round"
                    />
                  </svg>
                </button>
              </div>
              {offline && (
                <p className="mt-2 text-xs text-viewport-muted">
                  The BizBox assistant is offline. Your brief can still be
                  edited in Intake.
                </p>
              )}
            </form>
          </>
        )}
      </div>

      <div
        id={panelId("voice")}
        role="tabpanel"
        aria-labelledby={tabId("voice")}
        hidden={mode !== "voice"}
        className="flex min-h-0 flex-1 flex-col overflow-y-auto"
      >
        {mode === "voice" && (
          <>
            <div className="px-5">
              <VoicePanel
                adapter={voiceAdapter}
                title="Talk to BizBox"
                label="Voice assistant"
                tone="dark"
              />
            </div>
            <details
              open={historyOpen}
              onToggle={(event) => setHistoryOpen(event.currentTarget.open)}
              className="mt-auto flex min-h-0 flex-col border-t border-viewport-line"
            >
              <summary
                // State-driven (not the async native toggle) so a quick tab switch keeps it.
                onClick={(event) => {
                  event.preventDefault();
                  setHistoryOpen((open) => !open);
                }}
                className={`cursor-pointer px-5 py-3 text-sm ${focusRing}`}
              >
                Conversation
              </summary>
              <div className="flex max-h-72 min-h-0 flex-col">
                <Conversation
                  conversation={conversation}
                  id={`${base}-log-voice`}
                />
              </div>
            </details>
          </>
        )}
      </div>
    </aside>
  );
}
