"use client";

import { useMemo, useState } from "react";
import type { SiteRun } from "@/lib/contracts";
import type { RepresentativeRun } from "@/lib/contracts/evaluation";
import type { DayResult } from "@/lib/sim/contracts";
import { replayAt } from "@/components/replay/replay-state";
import {
  orderedStoredEvents,
  storedReplayAt,
  storedReplayBounds,
  storedReplayStations,
} from "@/components/replay/stored-replay-state";

const clock = (minute: number) =>
  `${String(Math.floor(minute / 60)).padStart(2, "0")}:${String(Math.floor(minute) % 60).padStart(2, "0")}`;

/** Real seeded events as a schematic replay, never measured station geometry. */
export function DecisionReplay(
  props: { label: string; fullReplayHref: string } & (
    | { run: SiteRun; representative: RepresentativeRun; example?: never }
    | { example: DayResult; run?: never; representative?: never }
  ),
) {
  const events = useMemo(
    () => (props.run ? orderedStoredEvents(props.run.events) : []),
    [props.run],
  );
  const bounds = props.example
    ? props.example.metrics
    : storedReplayBounds(events, props.representative!.hourly);
  const stations =
    props.example?.metrics.stations ?? storedReplayStations(events);
  const firstService =
    props.example?.events.find((event) => event.type === "service_start")
      ?.timeMin ??
    events.find((event) => event.type === "served")?.minute ??
    bounds.openMin;
  const [minute, setMinute] = useState(firstService);
  const frame = props.example
    ? replayAt(props.example.events, minute)
    : storedReplayAt(events, minute);
  const shownStations = Math.min(stations, 6);
  return (
    <section aria-label="Decision scene" className="min-w-0">
      <div className="flex items-center justify-between gap-2 text-xs">
        <span className="min-w-0 truncate" title={props.label}>
          {props.label}
        </span>
        <a
          href={props.fullReplayHref}
          className="shrink-0 font-semibold text-accent underline"
        >
          Full replay
        </a>
      </div>
      <svg
        role="img"
        aria-label={`${frame.waiting.length} waiting, ${frame.serving.length} in service, ${frame.served} served, ${frame.left} left at ${clock(minute)}. ${stations} schematic service lanes.`}
        viewBox="0 0 320 160"
        className="mt-1 h-40 w-full rounded-lg border border-line bg-field"
      >
        <text x="12" y="17" fill="var(--color-ink)" fontSize="11">
          Service lanes · schematic
        </text>
        {Array.from({ length: shownStations }, (_, index) => (
          <g key={index}>
            <rect
              x={12 + index * (296 / shownStations)}
              y="30"
              width={280 / shownStations}
              height="22"
              rx="3"
              fill="var(--color-accent)"
            />
            <text
              x={20 + index * (296 / shownStations)}
              y="45"
              fill="var(--color-on-accent)"
              fontSize="10"
            >
              {index + 1}
            </text>
          </g>
        ))}
        {frame.serving.slice(0, 6).map(([id, lane], index) => (
          <circle
            key={id}
            cx={28 + Math.min(lane, shownStations - 1) * (296 / shownStations)}
            cy="65"
            r="7"
            fill="var(--color-alternative)"
          >
            <title>In service {index + 1}</title>
          </circle>
        ))}
        <text x="12" y="90" fill="var(--color-ink)" fontSize="11">
          Queue: {frame.waiting.length} · In service: {frame.serving.length}
        </text>
        {frame.waiting.slice(0, 16).map((id, index) => (
          <circle
            key={id}
            cx={18 + index * 18}
            cy="107"
            r="5"
            fill="var(--color-alternative)"
          />
        ))}
        <text x="12" y="144" fill="var(--color-ink)" fontSize="11">
          Completed: {frame.served} · Left: {frame.left} · {clock(minute)}
        </text>
      </svg>
      <label className="mt-1 flex items-center gap-2 text-xs">
        Replay time
        <input
          aria-label="Decision replay time"
          aria-valuetext={clock(minute)}
          type="range"
          className="min-w-0 flex-1 accent-accent"
          min={bounds.openMin}
          max={bounds.closeMin}
          step="0.01"
          value={minute}
          onChange={(event) => setMinute(Number(event.target.value))}
        />
      </label>
    </section>
  );
}
