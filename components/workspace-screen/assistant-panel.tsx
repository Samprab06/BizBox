"use client";

import {
  useEffect,
  useId,
  useRef,
  useState,
  type KeyboardEvent,
  type ReactNode,
} from "react";
import { Button } from "@/components/ui/button";
import { IconButton } from "@/components/ui/icon-button";
import { ChatBubble } from "@/components/ui/chat";
import { Pill } from "@/components/ui/pill";
import { focusRing, pressable } from "@/components/ui/cn";
import { Markdown } from "@/components/ui/markdown";
import { VoicePanel } from "@/components/voice/voice-panel";
import { VOICE_LIMITS, type VoiceAdapter } from "@/lib/voice/contracts";
import { assistantModes, nextAssistantMode, type AssistantMode } from "./model";
import { useAssistantDraft } from "./use-assistant-draft";
import type { IntakeConversation } from "./use-intake-conversation";
import { assistantPresentation } from "./assistant-presentation";

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

function Conversation({
  messages,
  pending = false,
  id,
}: {
  messages: IntakeConversation["messages"];
  pending?: boolean;
  id: string;
}) {
  const log = useRef<HTMLDivElement>(null);
  const count = messages.length;
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
        <p className="text-muted">
          Ask BizBox about this space or your brief. Replies come from the
          BizBox intake assistant.
        </p>
      ) : (
        <ol className="space-y-3">
          {messages.map((entry, index) => (
            <li key={index}>
              <ChatBubble
                role={entry.role === "founder" ? "user" : "assistant"}
              >
                <span className="sr-only">
                  {entry.role === "founder" ? "You: " : "BizBox: "}
                </span>
                {entry.role === "founder" ? (
                  <span className="whitespace-pre-wrap break-words">
                    {entry.text}
                  </span>
                ) : (
                  <Markdown text={entry.text} className="break-words" />
                )}
              </ChatBubble>
            </li>
          ))}
        </ol>
      )}
      <p
        aria-live="polite"
        data-testid="assistant-thinking"
        className="mr-6 mt-3 text-muted"
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
  const presentation = assistantPresentation(
    conversation.session,
    conversation.messages,
  );

  const failure =
    conversation.failure?.source === "assistant" ? conversation.failure : null;

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
      className={`flex min-w-0 flex-col overflow-hidden rounded-panel border border-glass-edge bg-glass-fill text-ink shadow-glass backdrop-blur-glass ${className}`}
    >
      <header className="flex flex-wrap items-center justify-between gap-3 border-b border-line px-5 py-4">
        <div className="flex items-center gap-2">
          <h2
            id={`${base}-heading`}
            className="text-[15px] font-semibold tracking-tight"
          >
            Assistant
          </h2>
          <Pill
            data-agent-availability={availability}
            className="text-[11px] font-normal"
          >
            {status}
          </Pill>
        </div>
        <div className="flex items-center gap-2">
          <div
            role="tablist"
            aria-label="Assistant mode"
            className="flex rounded-control border border-glass-edge bg-field p-1"
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
                className={`flex items-center gap-1.5 rounded-control px-3 py-1.5 text-xs font-medium ${focusRing} ${pressable} ${
                  mode === value
                    ? "bg-accent text-on-accent"
                    : "text-muted hover:text-ink"
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

      {failure && (
        <div
          role="alert"
          className="mx-5 mt-3 rounded-control border border-line bg-panel-raised p-3 text-sm"
        >
          <p className="text-warn">{failure.message}</p>
          {failure.retry !== undefined && (
            <Button
              type="button"
              disabled={busy}
              onClick={conversation.retry}
              variant="glass"
              size="sm"
              className="mt-2"
            >
              Retry
            </Button>
          )}
        </div>
      )}
      {conversation.storageError && (
        <p role="alert" className="mx-5 mt-3 text-sm text-warn">
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
            <Conversation
              messages={presentation.messages}
              pending={busy}
              id={`${base}-log-text`}
            />
            {inline}
            <form
              className="border-t border-line p-4"
              onSubmit={(event) => {
                event.preventDefault();
                const text = draft.trim();
                if (!text || busy) return;
                // Offline, nothing is sent and the draft stays for later.
                if (!offline) setDraft("");
                void conversation.submit(text);
              }}
            >
              <div className="flex items-end gap-2 rounded-control border border-glass-edge bg-field p-1.5 pl-4 focus-within:outline-2 focus-within:outline-offset-2 focus-within:outline-focus-ring">
                <textarea
                  ref={field}
                  rows={1}
                  aria-label="Message the BizBox assistant"
                  placeholder={presentation.placeholder}
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
                  className="max-h-40 min-w-0 flex-1 resize-none bg-transparent py-2 text-sm text-ink placeholder:text-muted focus-visible:outline-none"
                />
                <IconButton
                  type="submit"
                  variant="primary"
                  disabled={busy || availability === "checking"}
                  aria-label={busy ? "Sending message" : "Send message"}
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
                </IconButton>
              </div>
              {offline && (
                <p className="mt-2 text-xs text-muted">
                  The BizBox assistant is offline. You can still edit your
                  brief under Your business in the top bar.
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
              className="mt-auto flex min-h-0 flex-col border-t border-line"
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
                  messages={presentation.messages}
                  pending={busy}
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
