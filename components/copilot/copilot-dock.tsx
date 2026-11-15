"use client";

import { useId, useState, type FormEvent, type ReactNode } from "react";
import type { CopilotTodo } from "@/lib/contracts/copilot-runtime";
import {
  toolLabel,
  type ActivityEntry,
  type ConfirmationCard,
} from "./controller";
import { useCopilot, type CopilotContextValue } from "./copilot-provider";
import { DiffCard } from "./diff-card";
import { orderScenarioTree } from "./scenario-api";

const button =
  "rounded-lg border border-line px-3 py-1.5 text-sm font-medium hover:bg-paper disabled:cursor-not-allowed disabled:opacity-60";
const primary =
  "rounded-lg bg-pine px-3 py-1.5 text-sm font-medium text-on-pine disabled:cursor-not-allowed disabled:opacity-60";

const PLAN_TEXT: Record<CopilotTodo["status"], string> = {
  pending: "To do",
  in_progress: "In progress",
  completed: "Done",
};
const ACTIVITY_TEXT: Record<ActivityEntry["status"], string> = {
  running: "Working",
  done: "Done",
  failed: "Failed",
};

function Section({ title, children }: { title: string; children: ReactNode }) {
  const id = useId();
  return (
    <section aria-labelledby={id} className="space-y-2">
      <h3 id={id} className="text-sm font-semibold">
        {title}
      </h3>
      {children}
    </section>
  );
}

function ScenarioSwitcher({ copilot }: { copilot: CopilotContextValue }) {
  const id = useId();
  const { scenarios, state } = copilot;
  if (scenarios.state === "idle" || scenarios.state === "loading")
    return (
      <p role="status" className="text-sm text-muted">
        Loading scenarios…
      </p>
    );
  if (scenarios.state === "error")
    return (
      <div className="flex flex-wrap items-center gap-2 text-sm">
        <p role="status" className="text-muted">
          {scenarios.message}
        </p>
        <button type="button" className={button} onClick={copilot.reload}>
          Retry
        </button>
      </div>
    );
  const ordered = orderScenarioTree(scenarios.value);
  if (ordered.length === 0)
    return (
      <p className="text-sm text-muted">
        No saved scenarios yet. The copilot proposes changes against a saved
        scenario, so save a baseline first.
      </p>
    );
  return (
    <div className="flex flex-col gap-1">
      <label htmlFor={id} className="text-xs font-medium text-muted">
        Active scenario (used by every page)
      </label>
      <select
        id={id}
        className="rounded-lg border border-line bg-surface px-2 py-1.5 text-sm"
        value={state.activeScenarioId ?? ""}
        onChange={(event) =>
          copilot.setActiveScenario(event.target.value || null)
        }
      >
        <option value="">No scenario chosen</option>
        {ordered.map(({ scenario, depth }) => (
          <option key={scenario.id} value={scenario.id}>
            {`${"— ".repeat(depth)}${scenario.label}${scenario.author === "agent" ? " (agent)" : ""}`}
          </option>
        ))}
      </select>
    </div>
  );
}

function Confirmation({
  card,
  disabled,
  onApprove,
}: {
  card: ConfirmationCard;
  disabled: boolean;
  onApprove: () => void;
}) {
  const id = useId();
  return (
    <div
      role="group"
      aria-labelledby={id}
      className="sw-card space-y-2"
      data-testid="copilot-confirmation"
    >
      <p id={id} className="text-sm font-semibold">
        Confirm this run
      </p>
      <p className="text-sm">
        {card.reason === "project_budget"
          ? "This run would go over the project's budget. Nothing runs until you approve it."
          : "Runs start only when you approve them."}
      </p>
      <button
        type="button"
        className={primary}
        disabled={disabled}
        onClick={onApprove}
      >
        {card.reason === "project_budget"
          ? "Approve run over budget"
          : "Approve run"}
      </button>
    </div>
  );
}

function Composer({ copilot }: { copilot: CopilotContextValue }) {
  const id = useId();
  const [draft, setDraft] = useState("");
  const submit = (event: FormEvent) => {
    event.preventDefault();
    const text = draft;
    setDraft("");
    void copilot.send(text);
  };
  return (
    <form onSubmit={submit} className="flex gap-2">
      <label htmlFor={id} className="sr-only">
        Message the copilot
      </label>
      <input
        id={id}
        value={draft}
        onChange={(event) => setDraft(event.target.value)}
        maxLength={8000}
        className="min-w-0 flex-1 rounded-lg border border-line bg-surface px-3 py-1.5 text-sm"
      />
      <button
        type="submit"
        className={primary}
        disabled={!draft.trim() || copilot.busy}
      >
        Send to copilot
      </button>
    </form>
  );
}

function RuntimeStatus({ copilot }: { copilot: CopilotContextValue }) {
  const { runtime, state } = copilot;
  if (runtime.state === "loading")
    return (
      <p role="status" className="text-sm text-muted">
        Connecting to the copilot…
      </p>
    );
  if (runtime.state === "error")
    return (
      <div className="flex flex-wrap items-center gap-2 text-sm">
        <p role="status" className="text-muted">
          {runtime.message}
        </p>
        <button type="button" className={button} onClick={copilot.reload}>
          Try again
        </button>
      </div>
    );
  if (!state.notice && !state.turn?.resumable) return null;
  return (
    <div className="flex flex-wrap items-center gap-2 text-sm">
      {state.notice && (
        <p
          role={state.notice.tone === "error" ? "alert" : "status"}
          className={
            state.notice.tone === "error" ? "text-danger" : "text-muted"
          }
        >
          {state.notice.text}
        </p>
      )}
      {state.turn?.resumable && (
        <button
          type="button"
          className={button}
          disabled={copilot.busy}
          onClick={() => void copilot.resume()}
        >
          Continue this turn
        </button>
      )}
    </div>
  );
}

/** HAC-84: the dock's content for an already-resolved copilot session. */
export function CopilotDockView({ copilot }: { copilot: CopilotContextValue }) {
  const panelId = useId();
  const headingId = useId();
  const { state, runtime } = copilot;
  const ready = runtime.state === "ready";
  const proposed = state.cards.filter((c) => c.status === "pending").length;
  return (
    <aside
      aria-labelledby={headingId}
      data-testid="copilot-dock"
      className="mt-8 min-w-0 print:hidden"
    >
      <div className="sw-card">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h2 id={headingId} className="text-base font-semibold">
            Copilot
            {proposed > 0 && (
              <span className="ml-2 text-sm font-normal text-muted">
                {proposed} proposed {proposed === 1 ? "change" : "changes"}
              </span>
            )}
          </h2>
          <button
            type="button"
            className={button}
            aria-expanded={state.expanded}
            aria-controls={panelId}
            onClick={() => copilot.setExpanded(!state.expanded)}
          >
            {state.expanded ? "Hide copilot" : "Show copilot"}
          </button>
        </div>
        <div
          id={panelId}
          hidden={!state.expanded}
          className="mt-4 space-y-5 border-t border-line pt-4"
        >
          {state.expanded && <RuntimeStatus copilot={copilot} />}
          <Section title="Scenario">
            {state.expanded && <ScenarioSwitcher copilot={copilot} />}
          </Section>
          {state.confirmations.length > 0 && (
            <Section title="Needs your confirmation">
              {state.confirmations.map((card) => (
                <Confirmation
                  key={card.scenarioId}
                  card={card}
                  disabled={copilot.busy || !ready}
                  onApprove={() => void copilot.confirm(card)}
                />
              ))}
            </Section>
          )}
          <Section title="Plan">
            {state.plan.length === 0 ? (
              <p className="text-sm text-muted">No plan yet.</p>
            ) : (
              <ol className="list-decimal space-y-1 pl-5 text-sm">
                {state.plan.map((item) => (
                  <li key={item.id}>
                    {item.content}{" "}
                    <span className="text-xs text-muted">
                      ({PLAN_TEXT[item.status]})
                    </span>
                  </li>
                ))}
              </ol>
            )}
          </Section>
          <Section title="Changes">
            {state.cards.length === 0 ? (
              <p className="text-sm text-muted">
                No changes proposed yet. Each agent change appears here once,
                with Run, Keep and Revert.
              </p>
            ) : (
              <div className="space-y-3">
                {state.cards.map((card) => (
                  <DiffCard
                    key={card.proposalId}
                    projectId={copilot.projectId}
                    card={card}
                    active={
                      !!card.proposedScenarioId &&
                      state.activeScenarioId === card.proposedScenarioId
                    }
                    onAction={(action) => void copilot.act(card, action)}
                    onRetryRevertVersion={() =>
                      void copilot.retryRevertVersion(card)
                    }
                  />
                ))}
              </div>
            )}
          </Section>
          <Section title="Tool activity">
            {state.activity.length === 0 ? (
              <p className="text-sm text-muted">No tool activity yet.</p>
            ) : (
              <ul className="space-y-1 text-sm">
                {state.activity.map((entry) => (
                  <li key={entry.id}>
                    {toolLabel(entry.tool)}{" "}
                    <span className="text-xs text-muted">
                      ({ACTIVITY_TEXT[entry.status]})
                    </span>
                    {entry.summary && (
                      <span className="block text-xs text-muted">
                        {entry.summary}
                      </span>
                    )}
                  </li>
                ))}
              </ul>
            )}
          </Section>
          {state.messages.length > 0 && (
            <Section title="Copilot conversation">
              <ul className="space-y-2 text-sm">
                {state.messages.map((message) => (
                  <li key={message.id}>
                    <span className="font-medium">
                      {message.role === "user" ? "You" : "BizBox"}:
                    </span>{" "}
                    {message.text}
                    {message.sources.length > 0 && (
                      <span className="block text-xs text-muted">
                        Sources:{" "}
                        {message.sources.map((s) => s.label).join(" · ")}
                      </span>
                    )}
                  </li>
                ))}
              </ul>
            </Section>
          )}
          {ready && <Composer copilot={copilot} />}
        </div>
      </div>
    </aside>
  );
}

/** The dock for the surrounding CopilotProvider; renders nothing outside one. */
export function CopilotDock() {
  const copilot = useCopilot();
  return copilot ? <CopilotDockView copilot={copilot} /> : null;
}
