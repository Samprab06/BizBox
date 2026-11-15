"use client";

import dynamic from "next/dynamic";
import { useEffect, useMemo, useState } from "react";
import { InspectPanel } from "@/components/city/inspect-panel";
import type { InspectPersona } from "@/lib/sim/inspect";
import type { DayResult } from "@/lib/sim/contracts";
import type { examplePersonas } from "../comparison/example-comparison";
import { replayAt } from "./replay-state";

const FloorPlan = dynamic(() => import("./floor-plan"), {
  ssr: false,
  loading: () => <p className="p-4">Loading layout...</p>,
});

function clock(minute: number) {
  const whole = Math.floor(minute);
  return `${String(Math.floor(whole / 60)).padStart(2, "0")}:${String(whole % 60).padStart(2, "0")}`;
}

export function ReplayPlayer({
  run,
  personas,
}: {
  run: DayResult;
  personas: typeof examplePersonas;
}) {
  const { openMin, closeMin, stations } = run.metrics;
  const [time, setTime] = useState(openMin);
  const [speed, setSpeed] = useState(1);
  const [playing, setPlaying] = useState(false);
  const [selected, setSelected] = useState("");
  const frame = replayAt(run.events, time);
  const inspectPersonas = useMemo(
    () =>
      personas.map((persona): InspectPersona => ({
        id: persona.id,
        label: persona.label,
        answers: {
          source: "Synthetic choice shares",
          where: persona.destinations,
          visitsPerMonth: persona.monthlyVisits ?? null,
        },
      })),
    [personas],
  );
  const running = playing && time < closeMin;

  useEffect(() => {
    if (!running) return;
    let previous = performance.now();
    let animation = 0;
    const tick = (now: number) => {
      const minutes = (Math.min(now - previous, 100) * speed) / 100;
      previous = now;
      setTime((minute) => Math.min(closeMin, minute + minutes));
      animation = requestAnimationFrame(tick);
    };
    animation = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(animation);
  }, [closeMin, running, speed]);

  return (
    <div className="space-y-4">
      <div
        className="h-72 overflow-hidden rounded-xl border border-line bg-paper"
        role="group"
        aria-label="Interactive modeled floor plan"
      >
        <FloorPlan
          waiting={frame.waiting}
          serving={frame.serving}
          stations={stations}
          selected={selected}
          select={setSelected}
        />
      </div>
      <div className="flex flex-wrap items-center gap-4">
        <button
          type="button"
          className="rounded-lg bg-pine px-4 py-2 font-semibold text-white"
          onClick={() => {
            if (time >= closeMin) setTime(openMin);
            setPlaying(!running);
          }}
        >
          {running ? "Pause" : time >= closeMin ? "Replay" : "Play"}
        </button>
        <label className="flex items-center gap-2 text-sm">
          Speed
          <select
            className="rounded-lg border border-line p-2"
            value={speed}
            onChange={(event) => setSpeed(Number(event.target.value))}
          >
            {[0.5, 1, 2, 4].map((rate) => (
              <option key={rate} value={rate}>
                {rate}×
              </option>
            ))}
          </select>
        </label>
        <span className="ml-auto font-mono" aria-label="Simulated time">
          {clock(time)}
        </span>
      </div>
      <label className="grid gap-1 text-sm font-medium">
        Seek to simulated time
        <input
          type="range"
          min={openMin}
          max={closeMin}
          step={0.01}
          value={time}
          aria-valuetext={clock(time)}
          onChange={(event) => {
            setPlaying(false);
            setTime(Number(event.target.value));
          }}
        />
      </label>
      <p className="text-sm text-muted" aria-label="Replay counts">
        {frame.waiting.length} waiting · {frame.serving.length} in service ·{" "}
        {frame.served} served · {frame.left} left
      </p>
      <InspectPanel
        events={run.events}
        minute={time}
        closeMin={closeMin}
        selectedId={selected}
        onSelect={setSelected}
        personas={inspectPersonas}
        followUnavailableReason="the modeled floor plan shows the whole shop"
      />
    </div>
  );
}
