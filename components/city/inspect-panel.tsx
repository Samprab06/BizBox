"use client";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input, Select } from "@/components/ui/input";

/**
 * HAC-93 (SIM-9): Inspect tab. Searchable customer list, Follow toggle and a card for the
 * selected customer at the shared playback minute.
 *
 * Renderer-agnostic: it owns no clock, camera or selection. The host (simulator workspace,
 * replay player, HAC-77 city view) passes the minute and the selected ID, and receives
 * `onSelect` / `onFollowChange`. A renderer that supports Follow reads `followTarget()`
 * from ./follow on each tick. Every value comes from `inspectCustomer()` (lib/sim/inspect).
 */
import { useId, useMemo, useState } from "react";
import type { KeyboardEvent, ReactNode } from "react";
import type { ArrivalSchedule, SimEvent } from "@/lib/sim/contracts";
import {
  arrivedCustomers,
  customerDisplayName,
  filterCustomers,
  inspectCustomer,
  personaIdAt,
  type Activity,
  type InspectCard,
  type InspectPersona,
  type InspectSource,
} from "@/lib/sim/inspect";
import type { AgentTrip } from "@/lib/sim/trips";

export type InspectPanelProps = {
  /** Canonical engine events for the run being inspected, in chronological order. */
  events: readonly SimEvent[];
  minute: number;
  /** Selected customer ID, or "" for none. Non-customer IDs (e.g. employees) are ignored. */
  selectedId: string;
  onSelect: (customerId: string) => void;
  /** Present when the host can lock a camera to the customer. */
  following?: boolean;
  onFollowChange?: (following: boolean) => void;
  /** Why Follow is unavailable, shown instead of the toggle. */
  followUnavailableReason?: string;
  schedule?: Pick<ArrivalSchedule, "customers"> | null;
  personas?: readonly InspectPersona[] | null;
  trips?: readonly AgentTrip[] | null;
  source?: InspectSource;
  closeMin?: number;
  /** Shown above the card, e.g. the scenario being inspected. */
  scenarioLabel?: string;
  /** Extra controls placed beside the list, e.g. a scenario switch. */
  controls?: ReactNode;
  className?: string;
};

const percent = new Intl.NumberFormat("en-US", {
  style: "percent",
  maximumFractionDigits: 1,
});
const decimal = new Intl.NumberFormat("en-US", { maximumFractionDigits: 1 });

export function clock(minute: number) {
  const whole = Math.floor(minute);
  return `${String(Math.floor(whole / 60) % 24).padStart(2, "0")}:${String(whole % 60).padStart(2, "0")}`;
}

const activityLabels: Record<Activity, string> = {
  not_arrived: "Not arrived yet",
  traveling: "Traveling",
  waiting: "Waiting in line",
  in_service: "In service",
  served: "Served, left",
  left: "Left without service",
};

const UNAVAILABLE = "Not available for this run";

function activityText(card: InspectCard) {
  if (card.activity === "traveling")
    return card.outcome
      ? "Traveling, leaving the site"
      : "Traveling to the site";
  if (card.atClose)
    return `${activityLabels[card.activity]} when the doors closed`;
  return activityLabels[card.activity];
}

function stayText(card: InspectCard, source: InspectSource) {
  const arrival = card.arrival!;
  const decision =
    arrival.decision === "join" ? "Joined the line" : "Left on arrival";
  const probability =
    arrival.stayProbability === null
      ? source === "stored"
        ? "Not stored"
        : "Unavailable"
      : percent.format(arrival.stayProbability);
  return `${probability} with ${arrival.lineLength} waiting · ${decision}`;
}

function Fact({
  term,
  children,
  origin,
}: {
  term: string;
  children: ReactNode;
  origin?: string;
}) {
  return (
    <div>
      <dt className="font-semibold">{term}</dt>
      <dd>
        {children}
        {origin && <span className="block text-xs text-muted">{origin}</span>}
      </dd>
    </div>
  );
}

function CustomerCard({
  card,
  source,
  scenarioLabel,
}: {
  card: InspectCard;
  source: InspectSource;
  scenarioLabel?: string;
}) {
  const { persona, travel, arrival, wait, service, answers } = card;
  const customerName = customerDisplayName(card.customerId, persona.label);
  const activityMinute =
    card.activity === "served" || card.activity === "left"
      ? card.departureMin
      : card.minute;
  if (card.activity === "not_arrived")
    return (
      <p role="status" className="text-sm text-muted">
        {customerName} has not arrived by {clock(card.minute)}. Details appear
        once they arrive; nothing later in the day is shown.
      </p>
    );
  const personaParts = [
    persona.kind ?? "kind unavailable",
    persona.incomeBand ?? "income unavailable",
    persona.ageBand ? `age ${persona.ageBand}` : "age unavailable",
    persona.hasKids === null
      ? "kids unavailable"
      : persona.hasKids
        ? "has kids"
        : "no kids",
  ];
  const anyPersonaDetail =
    persona.kind ??
    persona.incomeBand ??
    persona.ageBand ??
    persona.hasKids ??
    null;
  return (
    <div className="space-y-3">
      <p className="text-sm" role="status" aria-label="Customer activity">
        <span className="font-semibold">{customerName}</span> ·{" "}
        {activityText(card)}
        {activityMinute === null
          ? " · time unavailable"
          : ` at ${clock(activityMinute)}`}
        {scenarioLabel ? ` · ${scenarioLabel}` : ""}
      </p>
      <p className="rounded-lg bg-canvas p-3 text-sm" aria-label="Why">
        {card.why}
      </p>
      <dl className="grid gap-2 text-sm sm:grid-cols-2">
        <Fact
          term="Persona"
          origin={
            persona.id && persona.label ? `Persona ${persona.id}` : undefined
          }
        >
          {persona.label ??
            (persona.id ? customerDisplayName(persona.id) : UNAVAILABLE)}
          {anyPersonaDetail !== null ? (
            <span className="block">{personaParts.join(" · ")}</span>
          ) : (
            <span className="block text-muted">
              Kind, income, age and kids not supplied for this persona
            </span>
          )}
        </Fact>
        <Fact
          term="Origin and travel mode"
          origin={
            travel.geometry === "assumed"
              ? "Approximate trip on assumed street geometry"
              : travel.geometry === "provided"
                ? "Approximate trip on supplied geometry"
                : undefined
          }
        >
          {travel.originDistanceMeters === null
            ? "Origin distance unavailable (no trip geometry)"
            : `${decimal.format(travel.originDistanceMeters)} m from the door`}
          {" · "}
          {travel.mode ?? "travel mode unavailable"}
        </Fact>
        {arrival && (
          <Fact
            term="Stay probability at arrival"
            origin={`Arrival event at ${clock(arrival.minute)}${arrival.stayDraw === null ? "" : ` · schedule draw ${arrival.stayDraw.toFixed(2)}`}`}
          >
            {stayText(card, source)}
          </Fact>
        )}
        <Fact
          term="Wait"
          origin={
            wait
              ? wait.final
                ? "Service-start or abandonment event"
                : "Since the queue-entry event, at this minute"
              : undefined
          }
        >
          {wait
            ? `${decimal.format(wait.minutes)} min${wait.final ? "" : " so far"}`
            : arrival?.decision === "leave"
              ? "Did not wait"
              : "No wait recorded yet"}
        </Fact>
        <Fact
          term="Outcome"
          origin={
            service
              ? `Service started ${clock(service.startMin)} at counter ${service.station + 1}${service.durationMin === null ? "" : ` · ${decimal.format(service.durationMin)} min service`}`
              : undefined
          }
        >
          {card.outcome === "served"
            ? "Served"
            : card.outcome === "balked"
              ? "Walked away on arrival"
              : card.outcome === "reneged"
                ? "Left the line before service"
                : "Not decided yet at this time"}
        </Fact>
        {answers ? (
          <>
            <Fact term={answers.source}>
              {answers.where.length
                ? answers.where
                    .map(
                      ({ label, share }) =>
                        `${label} ${share === null ? "unknown" : percent.format(share)}`,
                    )
                    .join(" · ")
                : UNAVAILABLE}
            </Fact>
            <Fact term="Expected visits per month">
              {answers.visitsPerMonth === null
                ? UNAVAILABLE
                : decimal.format(answers.visitsPerMonth)}
            </Fact>
          </>
        ) : (
          <Fact term="Panel answers">
            No customer-panel answers for this persona in this run
          </Fact>
        )}
      </dl>
      {card.history.length > 0 && (
        <details className="text-sm">
          <summary className="cursor-pointer font-semibold">
            Events so far
          </summary>
          <ol className="mt-2 space-y-1">
            {card.history.map((entry, index) => (
              <li key={index}>
                {clock(entry.minute)} · {entry.label}
              </li>
            ))}
          </ol>
        </details>
      )}
    </div>
  );
}

export function InspectPanel({
  events,
  minute,
  selectedId,
  onSelect,
  following = false,
  onFollowChange,
  followUnavailableReason,
  schedule,
  personas,
  trips,
  source = "engine",
  closeMin,
  scenarioLabel,
  controls,
  className = "",
}: InspectPanelProps) {
  const id = useId();
  const [query, setQuery] = useState("");
  const arrived = useMemo(
    () => arrivedCustomers(events, minute),
    [events, minute],
  );
  const known = useMemo(
    () =>
      new Set([
        ...events.map((event) => event.customerId),
        ...(schedule?.customers.map((customer) => customer.id) ?? []),
      ]),
    [events, schedule],
  );
  const customerId = known.has(selectedId) ? selectedId : "";
  const labelFor = (customer: string) => {
    const personaId = personaIdAt(events, minute, customer, schedule);
    return customerDisplayName(
      customer,
      personas?.find((persona) => persona.id === personaId)?.label,
    );
  };
  const listed = filterCustomers(arrived, query, labelFor);
  const options =
    customerId && !listed.includes(customerId)
      ? [customerId, ...listed]
      : listed;
  const card = customerId
    ? inspectCustomer({
        events,
        minute,
        customerId,
        schedule,
        personas,
        trips,
        source,
        closeMin,
      })
    : null;

  function onKeyDown(event: KeyboardEvent<HTMLElement>) {
    if (event.key !== "Escape" || !customerId) return;
    event.stopPropagation();
    if (following) onFollowChange?.(false);
    else onSelect("");
  }

  return (
    <Card
      role="region"
      aria-label="Inspect customers"
      className={`min-w-0 space-y-3 rounded-xl border border-line p-4 ${className}`}
      onKeyDown={onKeyDown}
    >
      <div className="flex flex-wrap items-end gap-3">
        <label className="grid min-w-0 gap-1 text-sm font-medium">
          Search customers
          <Input
            type="search"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="ID or persona"
            aria-describedby={`${id}-count`}
            className="min-w-0 rounded-lg border border-line bg-panel-raised p-2 text-ink"
          />
        </label>
        <label className="grid min-w-0 gap-1 text-sm font-medium">
          Inspect a customer
          <Select
            className="min-w-0 max-w-full rounded-lg border border-line bg-panel-raised p-2 text-ink"
            value={customerId}
            onChange={(event) => onSelect(event.target.value)}
          >
            <option value="">Choose an arrival</option>
            {options.map((option) => (
              <option key={option} value={option}>
                {labelFor(option)}
                {arrived.includes(option) ? "" : " (not arrived yet)"}
              </option>
            ))}
          </Select>
        </label>
        {customerId &&
          (onFollowChange && !followUnavailableReason ? (
            <Button
              variant="glass"
              type="button"
              aria-pressed={following}
              onClick={() => onFollowChange(!following)}
              className="min-h-11 rounded-lg border border-accent px-4 text-sm font-semibold text-accent aria-pressed:bg-field"
            >
              {following ? "Stop following" : "Follow"}
            </Button>
          ) : (
            <p className="text-xs text-muted">
              Follow unavailable:{" "}
              {followUnavailableReason ?? "this view has no movable camera"}
            </p>
          ))}
        {controls}
      </div>
      <p id={`${id}-count`} className="text-xs text-muted" aria-live="polite">
        {listed.length} of {arrived.length} customers arrived by {clock(minute)}
        {query.trim() ? ` match “${query.trim()}”` : ""}. Later arrivals are not
        listed. Esc {following ? "stops following" : "clears the selection"}.
      </p>
      {card ? (
        <CustomerCard
          card={card}
          source={source}
          scenarioLabel={scenarioLabel}
        />
      ) : (
        <p className="text-sm text-muted">
          Choose a customer from the list, or click one in the view.
        </p>
      )}
    </Card>
  );
}
