"use client";

import { useId, useMemo } from "react";
import type { DayResult } from "@/lib/sim/contracts";
import { Card } from "@/components/ui/card";
import { Stat } from "@/components/ui/stat";
import { EvidenceBadge } from "@/components/ui/evidence-badge";
import { statsAt } from "./stats";

export type PlaybackSpeed = 1 | 6 | 18 | 60;
export type StatsCardProps = {
  run: DayResult;
  /** Distinct sites from the same scenario/day with matching opening hours. */
  areaRuns?: readonly DayResult[];
  scope: "site" | "area";
  minute: number;
  playing: boolean;
  speed: PlaybackSpeed;
  onScopeChange: (scope: "site" | "area") => void;
  onMinuteChange: (minute: number) => void;
  onPlayingChange: (playing: boolean) => void;
  onSpeedChange: (speed: PlaybackSpeed) => void;
};

function clock(minute: number) {
  const rounded = Math.floor(minute);
  return `${String(Math.floor(rounded / 60)).padStart(2, "0")}:${String(rounded % 60).padStart(2, "0")}`;
}

/** Controlled by the view's existing playback clock; no timer or simulation rerun. */
export function StatsCard(props: StatsCardProps) {
  const id = useId();
  const { run, areaRuns, scope, minute, playing, speed } = props;
  const effectiveScope = scope === "area" && areaRuns?.length ? "area" : "site";
  const runs = useMemo(
    () => (scope === "area" && areaRuns?.length ? areaRuns : [run]),
    [scope, areaRuns, run],
  );
  const stats = useMemo(() => statsAt(runs, minute), [runs, minute]);
  const maxServed = Math.max(1, stats.served);
  const width = stats.closeMin - stats.openMin;
  const points = stats.purchases
    .map(
      (point) =>
        `${((point.minute - stats.openMin) / width) * 240},${48 - (point.served / maxServed) * 44}`,
    )
    .join(" ");
  const button =
    "rounded border border-line px-3 py-2 text-sm disabled:opacity-50";

  return (
    <Card
      surface="paper"
      role="region"
      aria-label="Modeled day statistics"
      className="w-full max-w-md"
    >
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 className="font-semibold">Modeled day so far</h2>
        <EvidenceBadge kind="Simulation" />
      </div>
      <div
        role="group"
        aria-label="Statistics scope"
        className="my-3 flex flex-wrap gap-2"
      >
        <button
          type="button"
          className={button}
          aria-pressed={effectiveScope === "site"}
          onClick={() => props.onScopeChange("site")}
        >
          This site
        </button>
        <button
          type="button"
          className={button}
          aria-pressed={effectiveScope === "area"}
          disabled={!areaRuns?.length}
          onClick={() => props.onScopeChange("area")}
        >
          Area overview
        </button>
      </div>
      <div className="grid grid-cols-2 gap-4">
        <Stat
          label="Served"
          value={stats.served}
          qualifier="Completed services today"
        />
        <Stat
          label="Modeled revenue"
          value={new Intl.NumberFormat("en-US", {
            style: "currency",
            currency: "USD",
          }).format(stats.revenueUsd)}
          qualifier="Completed services only · USD"
        />
        <Stat
          label="Walk-aways"
          value={stats.walkAways}
          qualifier="Unmet modeled demand · left or abandoned"
        />
        <Stat
          label="Current line"
          value={stats.lineLength}
          qualifier="Customers waiting now"
        />
        <Stat
          label="Longest current wait"
          value={`${stats.longestWaitMin.toFixed(1)} min`}
          qualifier="Elapsed wait among customers still in line"
        />
      </div>
      <figure className="my-4">
        <figcaption className="text-sm text-muted">
          Cumulative purchases · {stats.served} completed
        </figcaption>
        <svg
          role="img"
          aria-label={`${stats.served} cumulative purchases by ${clock(stats.minute)}`}
          viewBox="0 0 240 52"
          className="mt-2 h-14 w-full"
        >
          <polyline
            points={points}
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            vectorEffect="non-scaling-stroke"
          />
        </svg>
      </figure>
      <p className="text-sm tabular-nums">
        {clock(stats.minute)} / {clock(stats.closeMin)} close
      </p>
      <div className="mt-2 flex flex-wrap items-center gap-3">
        <button
          type="button"
          className={button}
          aria-label={playing ? "Pause playback" : "Play playback"}
          onClick={() => props.onPlayingChange(!playing)}
        >
          {playing ? "Pause" : "Play"}
        </button>
        <label htmlFor={`${id}-speed`} className="text-sm">
          Playback speed
        </label>
        <select
          id={`${id}-speed`}
          className="rounded border border-line bg-surface px-2 py-2"
          value={speed}
          onChange={(e) =>
            props.onSpeedChange(Number(e.target.value) as PlaybackSpeed)
          }
        >
          {[1, 6, 18, 60].map((value) => (
            <option key={value} value={value}>
              {value}×
            </option>
          ))}
        </select>
      </div>
      <label htmlFor={`${id}-seek`} className="mt-3 block text-sm">
        Seek local time
      </label>
      <input
        id={`${id}-seek`}
        type="range"
        className="w-full accent-pine"
        min={stats.openMin}
        max={stats.closeMin}
        step={0.1}
        value={stats.minute}
        aria-valuetext={clock(stats.minute)}
        onChange={(e) => props.onMinuteChange(Number(e.target.value))}
      />
    </Card>
  );
}
