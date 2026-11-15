"use client";
import { Button } from "@/components/ui/button";
import { Input, Select } from "@/components/ui/input";

import { useId, useRef, useState } from "react";
import type { Origin } from "@/lib/sim/contracts";
import {
  experimentDelta,
  type ExperimentResult,
  type ExperimentSettings,
} from "@/lib/sim/experiment";
import { evidenceFor } from "@/lib/ui/evidence";
import { Card } from "@/components/ui/card";
import { EvidenceBadge } from "@/components/ui/evidence-badge";

export type ExperimentLever =
  | "averageTicketUsd"
  | "plannedStations"
  | "staffHeadcount"
  | "weekdayOpen"
  | "weekdayClose"
  | "weekendOpen"
  | "weekendClose"
  | "demandMultiplier"
  | "seed"
  | "dayType";
export type ExperimentOrigins = Record<ExperimentLever, Origin>;
type NumericLever = Exclude<ExperimentLever, "dayType">;
type LeverValue<K extends ExperimentLever> = K extends "dayType"
  ? ExperimentSettings["dayType"]
  : number;

/** Local draft edit only; persisted scenario author/provenance rules live in the host. */
export function editExperimentLever<K extends ExperimentLever>(
  settings: ExperimentSettings,
  origins: ExperimentOrigins,
  lever: K,
  value: LeverValue<K>,
): { settings: ExperimentSettings; origins: ExperimentOrigins } {
  let next = { ...settings };
  switch (lever) {
    case "weekdayOpen":
    case "weekdayClose":
    case "weekendOpen":
    case "weekendClose": {
      const day = lever.startsWith("weekday") ? "weekday" : "weekend";
      const bound = lever.endsWith("Open") ? "openMin" : "closeMin";
      next = {
        ...settings,
        hours: {
          ...settings.hours,
          [day]: { ...settings.hours[day], [bound]: value },
        },
      };
      break;
    }
    default:
      next = { ...settings, [lever]: value };
  }
  return { settings: next, origins: { ...origins, [lever]: "founder" } };
}

export type ExperimentPanelProps = {
  settings: ExperimentSettings;
  origins: ExperimentOrigins;
  onSettingsChange: (
    settings: ExperimentSettings,
    origins: ExperimentOrigins,
  ) => void;
  onRestart: (settings: ExperimentSettings) => void | Promise<void>;
  /** Host pins the current run and reruns through its existing scenario boundary. */
  onSaveBaselineAndRerun?: (
    settings: ExperimentSettings,
  ) => void | Promise<void>;
  current?: ExperimentResult;
  baseline?: ExperimentResult;
  busy?: boolean;
  error?: string;
};

const originLabels: Record<Origin, string> = {
  costar: "CoStar",
  public: "Public data",
  founder: "Founder",
  default: "Default",
};
const fields: {
  key: NumericLever;
  label: string;
  kind: "number" | "time";
  whole?: boolean;
  positive?: boolean;
}[] = [
  {
    key: "averageTicketUsd",
    label: "Average ticket ($)",
    kind: "number",
    positive: true,
  },
  {
    key: "plannedStations",
    label: "Planned stations",
    kind: "number",
    whole: true,
    positive: true,
  },
  {
    key: "staffHeadcount",
    label: "Staff headcount",
    kind: "number",
    whole: true,
  },
  {
    key: "demandMultiplier",
    label: "Demand multiplier",
    kind: "number",
    positive: true,
  },
  { key: "seed", label: "Seed", kind: "number", whole: true },
  { key: "weekdayOpen", label: "Weekday opens", kind: "time" },
  { key: "weekdayClose", label: "Weekday closes", kind: "time" },
  { key: "weekendOpen", label: "Weekend opens", kind: "time" },
  { key: "weekendClose", label: "Weekend closes", kind: "time" },
];
const valueFor = (settings: ExperimentSettings, key: NumericLever) => {
  switch (key) {
    case "weekdayOpen":
      return settings.hours.weekday.openMin;
    case "weekdayClose":
      return settings.hours.weekday.closeMin;
    case "weekendOpen":
      return settings.hours.weekend.openMin;
    case "weekendClose":
      return settings.hours.weekend.closeMin;
    default:
      return settings[key];
  }
};
const clock = (minute: number) =>
  `${String(Math.floor(minute / 60)).padStart(2, "0")}:${String(minute % 60).padStart(2, "0")}`;
const parse = (raw: string, field: (typeof fields)[number]): number | null => {
  if (!raw.trim()) return null;
  if (field.kind === "time") {
    if (!/^(?:[01]\d|2[0-3]):[0-5]\d$|^24:00$/.test(raw)) return null;
    const [hours, minutes] = raw.split(":").map(Number);
    return hours * 60 + minutes;
  }
  const number = Number(raw);
  return !Number.isFinite(number) ||
    number < 0 ||
    (field.positive && number === 0) ||
    (field.whole && !Number.isSafeInteger(number))
    ? null
    : number;
};
const usd = (value: number) =>
  value.toLocaleString("en-US", {
    style: "currency",
    currency: "USD",
    maximumFractionDigits: 2,
  });
const decimal = (value: number) =>
  value.toLocaleString("en-US", { maximumFractionDigits: 2 });
const numberOrUnknown = (
  value: number | null | undefined,
  format: (value: number) => string,
) => (value == null ? "Unknown" : format(value));
const difference = (
  value: number | null | undefined,
  format: (value: number) => string,
) =>
  value === undefined
    ? "—"
    : value === null
      ? "Unknown"
      : `${value > 0 ? "+" : value < 0 ? "−" : ""}${format(Math.abs(value))}`;

function OriginBadge({ label, origin }: { label: string; origin: Origin }) {
  return (
    <span
      className="flex flex-wrap items-center gap-1.5"
      aria-label={`${label} origin: ${origin}`}
    >
      <EvidenceBadge kind={evidenceFor(origin)} />
      <span className="text-xs text-muted">{originLabels[origin]}</span>
    </span>
  );
}

/** Controlled controls and result presentation. No engine, timer, API or persistence. */
export function ExperimentPanel({
  settings,
  origins,
  onSettingsChange,
  onRestart,
  onSaveBaselineAndRerun,
  current,
  baseline,
  busy = false,
  error,
}: ExperimentPanelProps) {
  const id = useId();
  // Only incomplete/invalid input text is local. Valid settings remain host-controlled.
  const [drafts, setDrafts] = useState<
    Partial<Record<NumericLever, { raw: string; source: number }>>
  >({});
  const [pending, setPending] = useState<"restart" | "baseline" | null>(null);
  const [actionError, setActionError] = useState<string>();
  const pendingRef = useRef(false);
  const invalidDraft = fields.some((field) => {
    const value = valueFor(settings, field.key);
    const draft =
      drafts[field.key]?.source === value ? drafts[field.key] : undefined;
    return (
      parse(
        draft?.raw ?? (field.kind === "time" ? clock(value) : String(value)),
        field,
      ) === null
    );
  });
  const invalidHours =
    settings.hours.weekday.closeMin <= settings.hours.weekday.openMin ||
    settings.hours.weekend.closeMin <= settings.hours.weekend.openMin;
  const locked = busy || pending !== null;
  const disabled = locked || invalidDraft || invalidHours;
  const comparable =
    current &&
    baseline &&
    current.selected.siteId === baseline.selected.siteId &&
    current.settings.dayType === baseline.settings.dayType;
  const delta = comparable ? experimentDelta(baseline, current) : undefined;
  const changed =
    current && JSON.stringify(current.settings) !== JSON.stringify(settings);

  const edit = <K extends ExperimentLever>(key: K, value: LeverValue<K>) => {
    const next = editExperimentLever(settings, origins, key, value);
    onSettingsChange(next.settings, next.origins);
    setActionError(undefined);
  };
  const act = async (kind: "restart" | "baseline") => {
    if (disabled || pendingRef.current) return;
    const handler = kind === "restart" ? onRestart : onSaveBaselineAndRerun;
    if (!handler || (kind === "baseline" && !current)) return;
    pendingRef.current = true;
    setPending(kind);
    setActionError(undefined);
    try {
      await handler(structuredClone(settings));
    } catch (failure) {
      setActionError(
        failure instanceof Error && failure.message.trim()
          ? failure.message
          : "The experiment could not be run. Try again.",
      );
    } finally {
      pendingRef.current = false;
      setPending(null);
    }
  };

  const rows = current
    ? [
        {
          label: "Monthly contribution",
          base: baseline?.monthly.contributionUsd,
          current: current.monthly.contributionUsd,
          delta: delta?.monthlyContributionUsd,
          format: usd,
        },
        {
          label: "Served",
          base: baseline?.selected.metrics.served,
          current: current.selected.metrics.served,
          delta: delta?.served,
          format: decimal,
        },
        {
          label: "Walk-aways",
          base: baseline?.selected.metrics.abandoned,
          current: current.selected.metrics.abandoned,
          delta: delta?.walkAways,
          format: decimal,
        },
        {
          label: "p90 wait (min)",
          base: baseline?.selected.metrics.p90WaitMin,
          current: current.selected.metrics.p90WaitMin,
          delta: delta?.p90WaitMin,
          format: decimal,
        },
        {
          label: "Peak-hour p90 wait (min)",
          base: baseline?.peakHourP90WaitMin,
          current: current.peakHourP90WaitMin,
          delta: delta?.peakHourP90WaitMin,
          format: decimal,
        },
      ]
    : [];

  return (
    <Card
      surface="paper"
      className="space-y-5"
      role="region"
      aria-labelledby={`${id}-title`}
      aria-busy={locked}
    >
      <header>
        <h2 id={`${id}-title`} className="text-lg font-semibold">
          Experiment
        </h2>
        <p className="mt-1 text-sm text-muted">
          Change an assumption, then restart to compare the modeled outcomes.
        </p>
      </header>
      <fieldset disabled={locked} className="min-w-0 space-y-4">
        <legend className="sr-only">Experiment settings</legend>
        <div className="grid min-w-0 gap-4 sm:grid-cols-2">
          {fields.map((field) => {
            const value = valueFor(settings, field.key);
            const draft =
              drafts[field.key]?.source === value
                ? drafts[field.key]
                : undefined;
            const raw =
              draft?.raw ??
              (field.kind === "time" ? clock(value) : String(value));
            const invalid = parse(raw, field) === null;
            const inputId = `${id}-${field.key}`;
            return (
              <div key={field.key} className="min-w-0 space-y-1.5">
                <label htmlFor={inputId} className="block text-sm font-medium">
                  {field.label}
                </label>
                <Input
                  id={inputId}
                  type={field.kind === "time" ? "text" : "number"}
                  inputMode={
                    field.kind === "time"
                      ? "text"
                      : field.whole
                        ? "numeric"
                        : "decimal"
                  }
                  min={
                    field.kind === "number"
                      ? field.positive && field.whole
                        ? 1
                        : 0
                      : undefined
                  }
                  step={
                    field.kind === "number"
                      ? field.whole
                        ? 1
                        : "any"
                      : undefined
                  }
                  value={raw}
                  required
                  aria-invalid={invalid}
                  aria-describedby={`${id}-hours-help${invalid ? ` ${inputId}-error` : ""}`}
                  className="min-h-11 w-full min-w-0 rounded-lg border border-muted bg-panel-raised px-3 py-2 text-sm text-ink tabular-nums outline-focus-ring focus-visible:outline-2 focus-visible:outline-offset-2 disabled:opacity-60"
                  onChange={(event) => {
                    const raw = event.target.value;
                    const parsed = parse(raw, field);
                    setDrafts((previous) => ({
                      ...previous,
                      [field.key]:
                        parsed === null ? { raw, source: value } : undefined,
                    }));
                    if (parsed !== null) edit(field.key, parsed);
                  }}
                />
                <OriginBadge label={field.label} origin={origins[field.key]} />
                {invalid && (
                  <p id={`${inputId}-error`} className="text-sm text-danger">
                    {field.kind === "time"
                      ? "Use HH:MM, from 00:00 to 24:00."
                      : `Enter a ${field.positive ? "positive" : "nonnegative"}${field.whole ? " whole" : ""} number.`}
                  </p>
                )}
              </div>
            );
          })}
          <div className="min-w-0 space-y-1.5">
            <label htmlFor={`${id}-day`} className="block text-sm font-medium">
              Displayed day
            </label>
            <Select
              id={`${id}-day`}
              value={settings.dayType}
              onChange={(event) =>
                edit(
                  "dayType",
                  event.target.value as ExperimentSettings["dayType"],
                )
              }
              className="min-h-11 w-full rounded-lg border border-muted bg-panel-raised px-3 py-2 text-sm text-ink outline-focus-ring focus-visible:outline-2 focus-visible:outline-offset-2"
            >
              <option value="weekday">Weekday</option>
              <option value="weekend">Weekend</option>
            </Select>
            <OriginBadge label="Displayed day" origin={origins.dayType} />
          </div>
        </div>
        <p id={`${id}-hours-help`} className="text-xs text-muted">
          Hours use 24-hour time. Use 24:00 for closing at midnight; closing
          must follow opening on the same day. Demand is a multiplier of the
          supplied baseline.
        </p>
        {invalidHours && (
          <p role="alert" className="text-sm text-danger">
            Closing must be later than opening for both weekday and weekend.
          </p>
        )}
      </fieldset>
      <div className="flex flex-wrap gap-2">
        <Button
          variant="primary"
          type="button"
          disabled={disabled}
          onClick={() => void act("restart")}
          className="min-h-11 rounded-lg bg-accent px-4 py-2 text-sm font-semibold text-on-accent disabled:opacity-60"
        >
          Restart with settings
        </Button>
        <Button
          variant="glass"
          type="button"
          disabled={disabled || !onSaveBaselineAndRerun || !current}
          aria-describedby={`${id}-save-help`}
          onClick={() => void act("baseline")}
          className="min-h-11 rounded-lg border border-muted bg-panel-raised px-4 py-2 text-sm font-semibold text-ink disabled:opacity-60"
        >
          Save baseline &amp; rerun
        </Button>
      </div>
      <p id={`${id}-save-help`} className="text-xs text-muted">
        {!onSaveBaselineAndRerun
          ? "Saving a baseline is not connected in this view."
          : !current
            ? "Run a preview before pinning a baseline."
            : "Pins the displayed run as Baseline, then reruns with the current settings."}
      </p>
      {locked && (
        <p role="status" className="text-sm text-muted">
          {pending === "baseline"
            ? "Pinning baseline and rerunning…"
            : "Preparing preview…"}
        </p>
      )}
      {(actionError || error) && (
        <p role="alert" className="text-sm text-danger">
          {actionError || error}
        </p>
      )}
      {current ? (
        <section
          aria-label="Experiment results"
          className="space-y-3 border-t border-line pt-4"
        >
          <div className="flex flex-wrap items-center gap-2">
            <h3 className="font-semibold">Modeled preview</h3>
            <EvidenceBadge kind="Simulation" />
          </div>
          <p className="text-xs text-muted">
            Alternative: {current.settings.dayType} · seed{" "}
            {current.settings.seed} · site {current.selected.siteId}.
            Single-seed modeled preview, not a sales forecast.
          </p>
          {baseline && (
            <p className="text-xs text-muted">
              Baseline: {baseline.settings.dayType} · seed{" "}
              {baseline.settings.seed} · site {baseline.selected.siteId}.
            </p>
          )}
          {changed && (
            <p role="status" className="text-sm text-warn">
              Settings changed. Restart to update this preview.
            </p>
          )}
          {baseline && !comparable && (
            <p role="status" className="text-sm text-warn">
              Baseline and Alternative use different sites or day types. Choose
              matching runs to see changes.
            </p>
          )}
          <p className="text-xs text-muted sm:hidden">
            Scroll to compare Baseline, Alternative and Change.
          </p>
          <div
            className="overflow-x-auto outline-focus-ring focus-visible:outline-2 focus-visible:outline-offset-2"
            role="region"
            aria-label="Experiment metrics table"
            tabIndex={0}
            onKeyDown={(event) => {
              if (
                event.target !== event.currentTarget ||
                event.altKey ||
                event.ctrlKey ||
                event.metaKey
              )
                return;
              if (event.key === "ArrowRight" || event.key === "ArrowLeft") {
                event.preventDefault();
                event.currentTarget.scrollBy({
                  left: event.key === "ArrowRight" ? 48 : -48,
                  behavior: "auto",
                });
              }
            }}
          >
            <table className="w-full min-w-[32rem] text-left text-sm tabular-nums">
              <caption className="sr-only">
                Baseline and Alternative experiment metrics; change is
                Alternative minus Baseline
              </caption>
              <thead>
                <tr>
                  <th scope="col" className="p-2">
                    Metric
                  </th>
                  <th
                    scope="col"
                    className="p-2 whitespace-nowrap text-baseline"
                  >
                    Baseline
                  </th>
                  <th
                    scope="col"
                    className="p-2 whitespace-nowrap text-alternative"
                  >
                    Alternative
                  </th>
                  <th scope="col" className="p-2">
                    Change
                  </th>
                </tr>
              </thead>
              <tbody>
                {rows.map((row) => (
                  <tr key={row.label} className="border-t border-line">
                    <th scope="row" className="p-2 font-medium">
                      {row.label}
                    </th>
                    <td className="p-2 whitespace-nowrap">
                      {baseline ? numberOrUnknown(row.base, row.format) : "—"}
                    </td>
                    <td className="p-2 whitespace-nowrap">
                      {numberOrUnknown(row.current, row.format)}
                    </td>
                    <td className="p-2 whitespace-nowrap">
                      {difference(row.delta, row.format)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {!baseline && (
            <p className="text-xs text-muted">
              Pin a baseline to compare changes.
            </p>
          )}
        </section>
      ) : (
        <p role="status" className="text-sm text-muted">
          Restart with settings to calculate a preview.
        </p>
      )}
    </Card>
  );
}
