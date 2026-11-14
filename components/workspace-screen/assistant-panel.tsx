"use client";

import { useEffect, useId, useRef, useState, type KeyboardEvent } from "react";
import { VoicePanel } from "@/components/voice/voice-panel";
import { VOICE_LIMITS, type VoiceAdapter } from "@/lib/voice/contracts";
import { assistantModes, nextAssistantMode, type AssistantMode } from "./model";
import { useAssistantDraft } from "./use-assistant-draft";
import styles from "./workspace-glass.module.css";
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
  useEffect(() => {
    const element = log.current;
    if (element) element.scrollTop = element.scrollHeight;
  }, [count]);
  return (
    <div
      ref={log}
      id={id}
      role="log"
      aria-label="Conversation"
      tabIndex={0}
      className={`${styles.conversation} ${focusRing}`}
    >
      {count === 0 ? (
        <p className={styles.conversationEmpty}>
          What would you like to work through?
        </p>
      ) : (
        <ol className={styles.messages}>
          {conversation.messages.map((entry, index) => (
            <li
              key={index}
              className={`${styles.message} ${entry.role === "founder" ? styles.founderMessage : ""}`}
            >
              <span className={styles.messageIdentity}>
                {entry.role === "founder" ? "You" : "BizBox"}
              </span>
              <span className="break-words">{entry.text}</span>
            </li>
          ))}
        </ol>
      )}
    </div>
  );
}

/**
 * One assistant, two input modes. Text and Voice are WAI-ARIA tabs over the same conversation
 * hook and the same composer draft; switching modes only changes which input is shown.
 */
export function AssistantPanel({
  projectId,
  conversation,
  selectedSiteId,
  summary,
}: {
  projectId: string;
  conversation: IntakeConversation;
  selectedSiteId?: string;
  summary: string;
}) {
  const [mode, setMode] = useState<AssistantMode>("text");
  const [draft, setDraft] = useAssistantDraft(projectId);
  const [historyOpen, setHistoryOpen] = useState(false);
  const tabs = useRef<Record<AssistantMode, HTMLButtonElement | null>>({
    text: null,
    voice: null,
  });
  const base = useId();
  const tabId = (value: AssistantMode) => `${base}-tab-${value}`;
  const panelId = (value: AssistantMode) => `${base}-panel-${value}`;
  const { availability, busy, failure } = conversation;
  const offline = availability === "offline";

  function select(next: AssistantMode, focus: boolean) {
    setMode(next);
    if (focus) tabs.current[next]?.focus();
  }

  function onTabKey(event: KeyboardEvent<HTMLButtonElement>) {
    const next = nextAssistantMode(mode, event.key);
    if (!next) return;
    event.preventDefault();
    select(next, true);
  }

  const voiceAdapter: VoiceAdapter = {
    readContext: () => ({
      projectId,
      mode: "chat",
      ...(selectedSiteId && selectedSiteId.length <= 200
        ? { selectedSiteId }
        : {}),
      summary: summary.slice(0, VOICE_LIMITS.summaryChars),
    }),
    submitTranscript: (text) => conversation.submit(text),
  };

  const status =
    availability === "checking"
      ? "Checking"
      : availability === "live"
        ? "Live"
        : "Offline";

  return (
    <aside aria-labelledby={`${base}-heading`} className={styles.assistant}>
      <header className={styles.assistantHeader}>
        <div className={styles.assistantHeading}>
          <h2 id={`${base}-heading`} className={styles.assistantTitle}>
            Assistant
          </h2>
          <span
            className={styles.assistantStatus}
            title="Connection to the existing BizBox intake assistant"
          >
            {status}
          </span>
        </div>
        <div
          role="tablist"
          aria-label="Assistant mode"
          className={styles.assistantModes}
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
              className={`${styles.assistantTab} ${focusRing} ${mode === value ? styles.activeAssistantTab : ""}`}
            >
              {value === "text" ? <ChatIcon /> : <MicIcon />}
              {MODE_LABEL[value]}
            </button>
          ))}
        </div>
      </header>
      <p className={styles.assistantScope}>
        Ask about your brief. Use the comparison controls to explore locations.
      </p>

      {failure && (
        <div role="alert" className={styles.assistantFailure}>
          <p className="text-viewport-warn">{failure.message}</p>
          {failure.retry !== undefined && (
            <button
              type="button"
              disabled={busy}
              onClick={conversation.retry}
              className={`${styles.secondary} ${styles.assistantRetry} ${focusRing}`}
            >
              Retry
            </button>
          )}
        </div>
      )}
      {conversation.storageError && (
        <p role="alert" className={styles.assistantFailure}>
          This browser could not save the conversation.
        </p>
      )}

      <div
        id={panelId("text")}
        role="tabpanel"
        aria-labelledby={tabId("text")}
        hidden={mode !== "text"}
        className={styles.assistantPanel}
      >
        {mode === "text" && (
          <>
            <Conversation conversation={conversation} id={`${base}-log-text`} />
            <form
              className={styles.composer}
              onSubmit={(event) => {
                event.preventDefault();
                const text = draft.trim();
                if (!text || busy) return;
                // Offline, nothing is sent and the draft stays for later.
                if (!offline) setDraft("");
                void conversation.submit(text);
              }}
            >
              <div className={styles.composerField}>
                <input
                  aria-label="Message the BizBox assistant"
                  placeholder="Ask about this space…"
                  maxLength={VOICE_LIMITS.transcriptChars}
                  value={draft}
                  onChange={(event) => setDraft(event.target.value)}
                  className={styles.composerInput}
                />
                <button
                  type="submit"
                  disabled={busy || availability === "checking"}
                  aria-label={busy ? "Sending message" : "Send message"}
                  className={`${styles.sendButton} ${focusRing}`}
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
                <p className={styles.assistantOffline}>
                  The assistant is offline. You can still edit your brief.
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
        className={`${styles.assistantPanel} ${styles.voiceContainer}`}
      >
        {mode === "voice" && (
          <>
            <div>
              <VoicePanel
                adapter={voiceAdapter}
                title="Talk to BizBox"
                label="Voice assistant"
                tone="dark"
                className={styles.voiceSurface}
              />
            </div>
            <details
              open={historyOpen}
              onToggle={(event) => setHistoryOpen(event.currentTarget.open)}
              className={styles.voiceHistory}
            >
              <summary
                // State-driven (not the async native toggle) so a quick tab switch keeps it.
                onClick={(event) => {
                  event.preventDefault();
                  setHistoryOpen((open) => !open);
                }}
                className={focusRing}
              >
                Conversation
              </summary>
              <div className={styles.voiceHistoryLog}>
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
