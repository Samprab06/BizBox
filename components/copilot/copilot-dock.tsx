"use client";

import { useId, useState, type FormEvent } from "react";
import {
  toolLabel,
  type ActivityEntry,
  type ConfirmationCard,
} from "./controller";
import { useCopilot, type CopilotContextValue } from "./copilot-provider";
import { DiffCard } from "./diff-card";
import { orderScenarioTree } from "./scenario-api";
import type { PlanItemStatus } from "./types";

const button =
  "rounded-lg border border-line px-3 py-1.5 text-sm font-medium hover:bg-paper disabled:cursor-not-allowed disabled:opacity-60";
const primary =
  "rounded-lg bg-pine px-3 py-1.5 text-sm font-medium text-on-pine disabled:cursor-not-allowed disabled:opacity-60";

const PLAN_TEXT: Record<PlanItemStatus, string> = {
  pending: "To do",
  in_progress: "In progress",
  done: "Done",
  failed: "Failed",
};
const ACTIVITY_TEXT: Record<ActivityEntry["status"], string> = {
  running: "Working",
  done: "Done",
  failed: "Failed",
};

function Section({
  title,
  children,
}: {
  title: string;
  children: React.ReactNode;
}) {
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
        <button
          type="button"
          className={button}
          onClick={copilot.reloadScenarios}
        >
          Retry
        </button>
      </div>
    );
  const ordered = orderScenarioTree(scenarios.scenarios);
  if (ordered.length === 0)
    return (
      <p className="text-sm text-muted">
        No saved scenarios yet. The baseline appears here once it is saved.
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
        <option value="">Baseline (no scenario chosen)</option>
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
  onAnswer,
}: {
  card: ConfirmationCard;
  onAnswer: (approved: boolean) => void;
}) {
  const id = useId();
  const reason =
    card.reason === "project_budget"
      ? "This run would go over the project's budget."
      : "Runs start only when you approve them.";
  return (
    <div
      role="group"
      aria-labelledby={id}
      className="sw-card space-y-2 border-warn"
      data-testid="copilot-confirmation"
    >
      <p id={id} className="text-sm font-semibold">
        Run scenario {card.scenarioId}?
      </p>
      <p className="text-sm">{reason}</p>
      <div className="flex gap-2">
        <button
          type="button"
          className={primary}
          disabled={card.pending}
          onClick={() => onAnswer(true)}
        >
          Approve run
        </button>
        <button
          type="button"
          className={button}
          disabled={card.pending}
          onClick={() => onAnswer(false)}
        >
          Not now
        </button>
      </div>
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
        className="min-w-0 flex-1 rounded-lg border border-line bg-surface px-3 py-1.5 text-sm"
      />
      <button type="submit" className={primary} disabled={!draft.trim()}>
        Send to copilot
      </button>
    </form>
  );
}

/** HAC-84: the dock's content for an already-resolved copilot session. */
export function CopilotDockView({ copilot }: { copilot: CopilotContextValue }) {
  const panelId = useId();
  const headingId = useId();
  const { state, runtime } = copilot;
  const connected = runtime.state === "connected";
  const pending = state.cards.filter(
    (c) => c.decision.state === "proposed",
  ).length;
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
            {pending > 0 && (
              <span className="ml-2 text-sm font-normal text-muted">
                {pending} proposed {pending === 1 ? "change" : "changes"}
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
          {!connected && (
            <p role="status" className="text-sm text-muted">
              {runtime.state === "unavailable" ? runtime.reason : null}
            </p>
          )}
          {copilot.sendError && (
            <p role="alert" className="text-sm text-danger">
              {copilot.sendError}
            </p>
          )}
          <Section title="Scenario">
            {state.expanded && <ScenarioSwitcher copilot={copilot} />}
          </Section>
          {state.confirmations.length > 0 && (
            <Section title="Needs your confirmation">
              {state.confirmations.map((card) => (
                <Confirmation
                  key={card.scenarioId}
                  card={card}
                  onAnswer={(approved) => void copilot.confirm(card, approved)}
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
                    {item.label}{" "}
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
                with Keep and Revert.
              </p>
            ) : (
              <div className="space-y-3">
                {state.cards.map((card) => (
                  <DiffCard
                    key={card.callId}
                    projectId={copilot.projectId}
                    card={card}
                    active={state.activeScenarioId === card.scenarioId}
                    onKeep={() => copilot.keep(card)}
                    onRevert={() => void copilot.revert(card)}
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
            <Section title="Copilot replies">
              <ul className="space-y-1 text-sm">
                {state.messages.map((message) => (
                  <li key={message.id}>
                    <span className="font-medium">
                      {message.role === "user" ? "You" : "BizBox"}:
                    </span>{" "}
                    {message.text}
                  </li>
                ))}
              </ul>
            </Section>
          )}
          {connected && state.suggestions.length > 0 && (
            <Section title="Suggested next">
              <div className="flex flex-wrap gap-2">
                {state.suggestions.map((chip) => (
                  <button
                    key={chip.id}
                    type="button"
                    className={button}
                    onClick={() => void copilot.send(chip.prompt)}
                  >
                    {chip.label}
                  </button>
                ))}
              </div>
            </Section>
          )}
          {connected && <Composer copilot={copilot} />}
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
