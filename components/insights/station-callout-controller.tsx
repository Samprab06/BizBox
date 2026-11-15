"use client";

import { useEffect, useRef, useState } from "react";
import type {
  StationExperimentRun,
  StationExperimentConfigurationId,
} from "@/lib/contracts/station-experiment-run";
import { EvidenceBadge } from "@/components/ui/evidence-badge";
import { StationCallout, stationTime } from "./station-callout";
import {
  parseStationRun,
  runStationBatch,
  boundedStationWrite,
  type StationSelection,
} from "./station-callout-client";
import { muted } from "./insights-frame";

const names: Record<StationExperimentConfigurationId, string> = {
  baseline: "Baseline",
  "plus-one": "+1 station and staff",
  "plus-two": "+2 stations and staff",
};
const button =
  "rounded border border-[var(--sw-baseline)] px-3 py-2 text-sm font-semibold disabled:opacity-60 focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-[var(--sw-baseline)]";
type Props = {
  projectId: string;
  comparisonId: string;
  siteId: string;
  profileId?: string;
  profileVersion?: number;
  seeds?: readonly number[];
  synthetic?: boolean;
  modelVersion?: string;
  /** Business-facing copy for the connected founder workspace. */
  founderLabels?: boolean;
};
export function StationCalloutController({ seeds, ...props }: Props) {
  const seedKey = seeds?.join(",");
  const identity = JSON.stringify([
    props.projectId,
    props.comparisonId,
    props.siteId,
    props.profileId,
    props.profileVersion,
    props.synthetic,
    props.modelVersion,
    seedKey,
  ]);
  return <StationController key={identity} {...props} seedKey={seedKey} />;
}
function StationController({
  projectId,
  comparisonId,
  siteId,
  profileId,
  profileVersion,
  seedKey,
  synthetic,
  modelVersion,
  founderLabels = false,
}: Omit<Props, "seeds"> & { seedKey?: string }) {
  const configurationNames = founderLabels
    ? { ...names, baseline: "Current setup" }
    : names;
  const [plan, setPlan] = useState<StationExperimentRun | null>(null),
    [loading, setLoading] = useState(true),
    [writing, setWriting] = useState(false),
    [attempt, setAttempt] = useState(0),
    [error, setError] = useState<string | null>(null),
    [needsRead, setNeedsRead] = useState(false);
  const generation = useRef(0),
    busy = useRef(false);
  const endpoint = `/api/projects/${encodeURIComponent(projectId)}/station-experiments`;
  const expected: StationSelection = {
    projectId,
    comparisonId,
    siteId,
    profileId,
    profileVersion,
    dayType: "weekday",
    seeds: seedKey?.split(",").map(Number),
    synthetic,
    modelVersion,
  };
  useEffect(() => {
    const current = ++generation.current,
      controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 15000);
    void (async () => {
      try {
        const query = new URLSearchParams({
          comparisonId,
          siteId,
          dayType: "weekday",
        });
        const response = await fetch(`${endpoint}?${query}`, {
          signal: controller.signal,
          cache: "no-store",
        });
        if (!response.ok)
          throw new Error(
            "Station plan could not be loaded. Retry reading progress before running configurations.",
          );
        const value = parseStationRun(await response.json(), {
          projectId,
          comparisonId,
          siteId,
          profileId,
          profileVersion,
          dayType: "weekday",
          seeds: seedKey?.split(",").map(Number),
          synthetic,
          modelVersion,
        });
        if (generation.current === current) {
          setPlan(value);
          setNeedsRead(false);
        }
      } catch {
        if (generation.current === current)
          setError(
            "Station plan could not be verified. Retry reading progress before running configurations.",
          );
      } finally {
        clearTimeout(timeout);
        if (generation.current === current) setLoading(false);
      }
    })();
    return () => {
      generation.current = current + 1;
      controller.abort();
      clearTimeout(timeout);
    };
  }, [
    projectId,
    comparisonId,
    siteId,
    profileId,
    profileVersion,
    endpoint,
    attempt,
    seedKey,
    synthetic,
    modelVersion,
  ]);
  const visible =
    plan?.source.projectId === projectId &&
    plan.source.comparisonId === comparisonId &&
    plan.source.siteId === siteId &&
    (!profileId || plan.source.profileId === profileId) &&
    (!profileVersion || plan.source.profileVersion === profileVersion)
      ? plan
      : null;
  async function run(confirm = false) {
    if (!visible || busy.current || loading || needsRead) return;
    busy.current = true;
    setWriting(true);
    setError(null);
    const current = generation.current;
    try {
      await runStationBatch(visible, {
        confirm,
        isCurrent: () => current === generation.current,
        onUpdate: setPlan,
        request: async (input) => {
          return boundedStationWrite(
            (async () => {
              // Do not abort writes: abandoning a view does not cancel reserved work.
              const response = await fetch(endpoint, {
                method: "POST",
                headers: { "content-type": "application/json" },
                body: JSON.stringify({
                  comparisonId,
                  siteId,
                  dayType: "weekday",
                  ...input,
                }),
              });
              if (!response.ok) throw new Error("Station request failed");
              return parseStationRun(await response.json(), expected);
            })(),
          );
        },
      });
    } catch {
      if (current === generation.current) {
        setError(
          "The last request's status could not be verified. Completed work remains recorded. Refresh progress before continuing.",
        );
        setNeedsRead(true);
      }
    } finally {
      if (current === generation.current) {
        busy.current = false;
        setWriting(false);
      }
    }
  }
  const completed =
    visible?.configurations.filter((config) => config.status === "succeeded")
      .length ?? 0;
  const result = visible?.result;
  return (
    <section
      aria-label="Station experiment"
      aria-busy={loading || writing}
      className="min-w-0 space-y-3 text-sm"
    >
      <h4 className="text-base font-semibold">
        {founderLabels
          ? "Compare service setups"
          : "Check whole-day station alternatives"}
      </h4>
      <p className={muted}>
        Uses saved assumptions and the original paired seeds. Options run one at
        a time. Completed results stay saved if the next option needs budget
        confirmation. Opening this view does not run an experiment.
      </p>
      <p className={muted}>
        <EvidenceBadge kind="Assumption" /> The +1/+2 whole-day station and
        staff increments are proposed assumptions; other inputs retain the saved
        snapshot.
      </p>
      {loading && <p role="status">Reading station experiment plan…</p>}
      {error && (
        <p role="alert" className="text-[var(--sw-assumption-ink)]">
          {error}
        </p>
      )}
      {visible && (
        <>
          <p className={"break-words " + muted}>
            <EvidenceBadge kind="Simulation" />{" "}
            {visible.source.synthetic ? "Example data · " : ""}Saved comparison{" "}
            {visible.source.comparisonId} · profile {visible.source.profileId} v
            {visible.source.profileVersion} · {visible.source.seedCount} paired
            seeds · {visible.source.demandSource.toUpperCase()}
          </p>
          {visible.source.sourceNotice && (
            <p className="font-semibold text-[var(--sw-assumption-ink)]">
              {visible.source.sourceNotice}
            </p>
          )}
          {visible.source.outdated === true && (
            <p
              role="status"
              className="font-semibold text-[var(--sw-assumption-ink)]"
            >
              Outdated comparison: this experiment retains the saved profile and
              assumptions.
            </p>
          )}
          {(visible.source.outdated === null ||
            visible.source.currentProfileVersion === null) && (
            <p role="status" className="text-[var(--sw-assumption-ink)]">
              The current profile version could not be checked. Freshness is
              unknown; the saved snapshot is retained.
            </p>
          )}
          <ul
            aria-label="Station configuration progress"
            className="grid min-w-0 gap-3 sm:grid-cols-3"
          >
            {visible.configurations.map((config) => (
              <li
                key={config.id}
                className="min-w-0 rounded border border-[var(--sw-line)] p-3"
              >
                <strong>{configurationNames[config.id]}</strong>
                <p className="mt-1 font-semibold">
                  {config.status}
                  {config.cached ? " · cached" : ""}
                </p>
                <p>
                  {config.plannedStations} planned / {config.effectiveStations}{" "}
                  effective stations · {config.staffHeadcount} staff
                </p>
                <p className={muted}>
                  Whole days: weekday{" "}
                  {stationTime(config.hours.weekday.openMin)}–
                  {stationTime(config.hours.weekday.closeMin)}; weekend{" "}
                  {stationTime(config.hours.weekend.openMin)}–
                  {stationTime(config.hours.weekend.closeMin)}
                </p>
                <p className="mt-1">
                  {config.costUnits} simulation budget units
                </p>
              </li>
            ))}
          </ul>
          <p role="status">
            {completed} of {visible.configurations.length} configurations
            completed.{writing ? " Running the explicit request…" : ""}
          </p>
          {visible.confirmation && (
            <p className="font-semibold text-[var(--sw-assumption-ink)]">
              Next configuration:{" "}
              {configurationNames[visible.confirmation.configurationId]}{" "}
              requires {visible.confirmation.costUnits} units;{" "}
              {visible.confirmation.remainingUnits} units remain. Already
              completed configurations stay recorded.
            </p>
          )}
          {visible.status === "unavailable" && (
            <p role="status">
              {visible.unavailable?.reason ??
                "Station alternatives are unavailable for this saved data."}
            </p>
          )}
          {result?.status === "available" && result.selected && (
            <div className="border-t border-[var(--sw-line)] pt-4">
              <StationCallout
                value={result.selected}
                sourceLabel={`${founderLabels ? "Saved current setup" : "Saved evaluated baseline"} ${result.identity.baselineComparisonId}`}
              />
            </div>
          )}
          {visible.status === "ready" &&
            result?.status === "available" &&
            !result.selected && (
              <p role="status">
                No tested station alternative adds modeled monthly revenue. No
                station recommendation is shown.
              </p>
            )}
        </>
      )}
      <div className="flex flex-wrap gap-2">
        {visible?.nextConfigurationId && visible.status !== "unavailable" && (
          <button
            type="button"
            className={button}
            disabled={loading || writing || needsRead || !!error}
            onClick={() => void run(visible.status === "needs_confirmation")}
          >
            {writing
              ? "Running station experiment…"
              : visible.status === "needs_confirmation"
                ? `Confirm ${visible.confirmation?.costUnits ?? ""} budget units`
                : completed || visible.status === "running"
                  ? "Continue station experiment"
                  : founderLabels
                    ? "Compare setups"
                    : "Run planned station configurations"}
          </button>
        )}
        <button
          type="button"
          className={button}
          disabled={loading || writing}
          onClick={() => {
            setLoading(true);
            setError(null);
            setAttempt((value) => value + 1);
          }}
        >
          {visible ? "Refresh station progress" : "Retry station plan"}
        </button>
      </div>
    </section>
  );
}
