"use client";

import dynamic from "next/dynamic";
import { useEffect, useState } from "react";
import type { CSSProperties } from "react";
import { replayAt } from "../replay/replay-state";
import type { DemoData, demoPlan } from "./fixture";
import type { SimulatorStory } from "./stored";
import { glass } from "./glass";
import type { RenderQuality } from "./render-policy";

const Neighborhood = dynamic(() => import("./neighborhood"), { ssr: false });
const Scene = dynamic(() => import("./scene"), { ssr: false });
const usd = new Intl.NumberFormat("en-US", {
  style: "currency",
  currency: "USD",
  maximumFractionDigits: 0,
});
const speeds = [0.5, 1, 2, 4];
const playbackFrameInterval = 1000 / 60;

function clock(minute: number) {
  const total = Math.floor(minute) % 1440;
  const hour = Math.floor(total / 60);
  return `${hour % 12 || 12}:${String(total % 60).padStart(2, "0")} ${hour < 12 ? "AM" : "PM"}`;
}

/** The bundled fixture's copy, labelled as an example (HAC-63). */
export const EXAMPLE_STORY: SimulatorStory = {
  eyebrow: "Example · Houston coffee shop",
  title: "Does a second station pay off?",
  intro: "",
  scenarioLabels: ["Current", "Alternative"],
  compare: true,
  footnote:
    "Example data, not a researched property: 110 generated customers at a fixture site. Illustrative block and vehicles. Monthly totals repeat one weekday 22 times and include ingredients, labor, rent and buildout amortization; taxes and other overhead are excluded.",
};

export function SimulatorDemo({
  data,
  plan,
  coordinates,
  story = EXAMPLE_STORY,
}: {
  data: DemoData;
  plan: typeof demoPlan;
  coordinates?: { longitude: number; latitude: number; tilesetUrl: string };
  /** Copy and provenance; defaults to the labelled example. */
  story?: SimulatorStory;
}) {
  const { openMin, closeMin } = data[0].run.metrics;
  const start = coordinates ? 0 : openMin;
  const end = coordinates ? 1440 : closeMin;
  const [minute, setMinute] = useState(coordinates ? 360 : openMin);
  const [playing, setPlaying] = useState(false);
  const [speed, setSpeed] = useState(1);
  const [cutaway, setCutaway] = useState(false);
  const [selected, select] = useState("");
  const [quality, setQuality] = useState<RenderQuality>("balanced");
  const running = playing && minute < end;

  useEffect(() => {
    if (!running) return;
    let previous = performance.now();
    let committed = previous;
    let accumulated = 0;
    let request = 0;
    function tick(now: number) {
      if (document.hidden) return;
      const elapsed = Math.min(now - previous, 100);
      previous = now;
      accumulated += elapsed;
      // Keep camera input independent of React/overlay updates on high-Hz displays.
      if (now - committed >= playbackFrameInterval) {
        const elapsedForFrame = accumulated;
        accumulated = 0;
        committed = now - ((now - committed) % playbackFrameInterval);
        setMinute((value) =>
          Math.min(
            end,
            value + (elapsedForFrame * speed) / (coordinates ? 55 : 125),
          ),
        );
      }
      request = requestAnimationFrame(tick);
    }
    function resumeWhenVisible() {
      cancelAnimationFrame(request);
      previous = performance.now();
      committed = previous;
      accumulated = 0;
      if (!document.hidden) request = requestAnimationFrame(tick);
    }
    resumeWhenVisible();
    document.addEventListener("visibilitychange", resumeWhenVisible);
    return () => {
      cancelAnimationFrame(request);
      document.removeEventListener("visibilitychange", resumeWhenVisible);
    };
  }, [running, end, speed, coordinates]);

  const arrivals = replayAt(data[0].run.events, minute).arrivals;
  const [base, alternative] = data;
  const gain = alternative
    ? alternative.monthly.contributionUsd - base.monthly.contributionUsd
    : 0;
  const kept = alternative
    ? base.run.metrics.abandoned - alternative.run.metrics.abandoned
    : 0;
  const shopMinute = Math.min(closeMin, Math.max(openMin, minute));

  return (
    <div className="relative min-h-dvh bg-[#06080d] text-white antialiased">
      {coordinates ? (
        <Neighborhood {...coordinates} minute={minute} quality={quality}>
          <label
            className={`${glass} absolute top-20 right-4 z-10 flex items-center gap-2 px-3 py-2 text-xs text-white/80`}
          >
            Graphics
            <select
              aria-label="Graphics quality"
              value={quality}
              onChange={(event) =>
                setQuality(event.target.value as RenderQuality)
              }
              className="rounded-md bg-[#11141b] px-2 py-1 text-white outline-none focus-visible:ring-2 focus-visible:ring-white/60"
            >
              <option value="balanced">Balanced</option>
              <option value="detailed">Detailed</option>
            </select>
          </label>
          <Timeline
            label="Neighborhood timeline"
            className="absolute inset-x-4 bottom-8 z-10 sm:inset-x-auto sm:left-1/2 sm:w-[min(40rem,calc(100vw-3rem))] sm:-translate-x-1/2"
            minute={minute}
            min={start}
            max={end}
            step={1}
            running={running}
            ended={minute >= end}
            speed={speed}
            onSpeed={setSpeed}
            onToggle={() => {
              if (minute >= end) setMinute(start);
              setPlaying(!running);
            }}
            onSeek={(value) => {
              setPlaying(false);
              setMinute(value);
            }}
          />
        </Neighborhood>
      ) : (
        <p
          role="status"
          className="mx-auto max-w-5xl px-6 pt-8 text-sm text-white/50"
        >
          3D neighborhood unavailable. The operating replay is below.
        </p>
      )}

      <main
        id="operating-plan"
        className="relative isolate mx-auto max-w-5xl scroll-mt-4 px-5 py-16 sm:px-6 sm:py-24"
      >
        <div
          aria-hidden
          className="pointer-events-none absolute inset-0 -z-10 overflow-hidden"
        >
          <div className="absolute -top-20 left-[10%] size-[28rem] rounded-full bg-emerald-500/15 blur-[120px]" />
          <div className="absolute top-[40%] right-[5%] size-[30rem] rounded-full bg-indigo-500/15 blur-[130px]" />
        </div>

        <header className="max-w-2xl">
          <p className="text-xs font-medium tracking-[0.18em] text-white/40 uppercase">
            {story.eyebrow}
          </p>
          <h1 className="mt-3 text-3xl font-semibold tracking-tight text-balance sm:text-5xl">
            {story.title}
          </h1>
          <p className="mt-4 text-white/50 text-pretty">
            {story.intro ||
              `Same 110 customers, same draws. One extra staffed station and ${usd.format(plan.alternativeBuildout - plan.baselineBuildout)} more buildout.`}
          </p>
        </header>

        {story.compare && alternative && (
          <dl
            className={`${glass} mt-12 grid divide-white/10 sm:grid-cols-3 sm:divide-x`}
          >
            <Stat
              label="Monthly gain"
              value={`${gain >= 0 ? "+" : "−"}${usd.format(Math.abs(gain))}`}
              accent={gain >= 0}
            />
            <Stat
              label="Customers kept / day"
              value={`${kept >= 0 ? "+" : "−"}${Math.abs(kept)}`}
              accent={kept >= 0}
            />
            <Stat
              label="Extra buildout"
              value={usd.format(
                plan.alternativeBuildout - plan.baselineBuildout,
              )}
            />
          </dl>
        )}

        <ul className="mt-4 flex flex-wrap gap-2 text-xs text-white/50">
          {[
            `${plan.area.toLocaleString("en-US")} sq ft`,
            `${clock(openMin)} – ${clock(closeMin)}`,
            `${usd.format(plan.rentPerSquareFoot)}/sq ft/yr rent`,
            `${usd.format(plan.ticket)} ticket`,
            `${usd.format(plan.wage)}/hr labor`,
          ].map((chip) => (
            <li
              key={chip}
              className="rounded-full border border-white/10 bg-white/[0.03] px-3 py-1"
            >
              {chip}
            </li>
          ))}
        </ul>

        <div className="sticky top-4 z-20 mt-12 flex flex-wrap items-center gap-2">
          <Timeline
            label="Shared playback"
            className="min-w-0 flex-1"
            minute={shopMinute}
            min={openMin}
            max={closeMin}
            step={0.01}
            running={running}
            ended={minute >= closeMin}
            speed={speed}
            onSpeed={setSpeed}
            onToggle={() => {
              if (minute >= closeMin || minute < openMin) {
                setMinute(openMin);
                setPlaying(true);
                return;
              }
              setPlaying(!running);
            }}
            onSeek={(value) => {
              setPlaying(false);
              setMinute(value);
            }}
          />
          <button
            type="button"
            aria-pressed={cutaway}
            onClick={() => setCutaway(!cutaway)}
            className={`${glass} self-stretch rounded-full px-5 text-sm font-medium transition ${cutaway ? "bg-white/[0.16] text-white" : "text-white/60 hover:text-white"}`}
          >
            Focus on shop
          </button>
        </div>

        <div className="mt-4 grid gap-4 lg:grid-cols-2">
          {data.map(({ run, monthly }, index) => {
            const frame = replayAt(run.events, minute);
            const customer = frame.arrivals.get(selected);
            return (
              <section key={index} className={`${glass} p-2`}>
                <header className="flex items-baseline justify-between px-4 pt-3 pb-3">
                  <h2 className="font-medium">
                    {story.scenarioLabels[index] ?? `Scenario ${index + 1}`}
                  </h2>
                  <span className="text-xs text-white/40">
                    {run.metrics.stations}{" "}
                    {run.metrics.stations === 1 ? "station" : "stations"}
                  </span>
                </header>
                <div
                  className="h-72 overflow-hidden rounded-xl bg-black/20"
                  aria-label="Modeled block and café"
                >
                  <Scene
                    quality={quality}
                    run={run}
                    minute={minute}
                    cutaway={cutaway}
                    selected={selected}
                    select={select}
                  />
                </div>
                <div className="grid grid-cols-3 px-4 pt-5 pb-1">
                  <Live label="Served" value={frame.served} />
                  <Live label="Waiting" value={frame.waiting.length} />
                  <Live label="Left" value={frame.left} warn={frame.left > 0} />
                </div>
                <dl className="space-y-2 px-4 pt-4 pb-4 text-sm">
                  <Row
                    label="Day-end"
                    value={`${run.metrics.served} served · ${run.metrics.abandoned} left`}
                  />
                  <Row
                    label="Monthly revenue"
                    value={usd.format(monthly.revenueUsd)}
                  />
                  <Row
                    label="After costs"
                    value={usd.format(monthly.contributionUsd)}
                    strong
                  />
                </dl>
                {selected && (
                  <p className="mx-2 mb-2 rounded-xl bg-white/[0.04] px-3 py-2 text-xs text-white/50">
                    <span className="text-white/80">{selected}</span> ·{" "}
                    {customer
                      ? `${customer.lineLength} in line · ${Math.round(customer.stayProbability * 100)}% join · ${customer.decision === "join" ? "joined" : "left"}`
                      : "not arrived yet"}
                  </p>
                )}
              </section>
            );
          })}
        </div>

        <div className="mt-4 flex justify-end">
          <select
            aria-label="Inspect a customer"
            className={`${glass} cursor-pointer rounded-full px-4 py-2 text-sm text-white/70 outline-none focus-visible:ring-2 focus-visible:ring-white/30 [&>option]:bg-[#11141b]`}
            value={arrivals.has(selected) ? selected : ""}
            onChange={(event) => select(event.target.value)}
          >
            <option value="">
              {arrivals.size ? "Inspect a customer" : "No arrivals yet"}
            </option>
            {[...arrivals.keys()].map((id) => (
              <option key={id}>{id}</option>
            ))}
          </select>
        </div>

        {story.provenance && (
          <section
            aria-label="Recorded run provenance"
            className={`${glass} mt-12 p-4 text-xs text-white/60`}
          >
            <h2 className="font-medium text-white/80">
              {story.provenance.label}
            </h2>
            <ul className="mt-2 space-y-1">
              {story.provenance.items.map((item) => (
                <li key={item}>{item}</li>
              ))}
            </ul>
          </section>
        )}
        <p className="mt-16 max-w-2xl text-xs leading-relaxed text-white/30">
          {story.footnote}
        </p>
      </main>
    </div>
  );
}

function Timeline({
  label,
  className,
  minute,
  min,
  max,
  step,
  running,
  ended,
  speed,
  onSpeed,
  onToggle,
  onSeek,
}: {
  label: string;
  className: string;
  minute: number;
  min: number;
  max: number;
  step: number;
  running: boolean;
  ended: boolean;
  speed: number;
  onSpeed: (speed: number) => void;
  onToggle: () => void;
  onSeek: (minute: number) => void;
}) {
  const time = clock(minute);
  const action = running ? "Pause" : ended ? "Replay" : "Play";
  return (
    <section
      aria-label={label}
      className={`${glass} flex items-center gap-4 rounded-full p-2 pr-3 ${className}`}
    >
      <button
        type="button"
        aria-label={action}
        title={action}
        onClick={onToggle}
        className="grid size-11 shrink-0 place-items-center rounded-full bg-white text-black transition hover:bg-white/90 active:scale-95"
      >
        <svg
          aria-hidden
          viewBox="0 0 20 20"
          className="size-4"
          fill="currentColor"
        >
          {running ? (
            <path d="M5.5 4h3v12h-3zM11.5 4h3v12h-3z" />
          ) : ended ? (
            <path
              d="M4.5 10a5.5 5.5 0 1 0 1.8-4.1M4.5 3.5v3h3"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
              strokeLinejoin="round"
            />
          ) : (
            <path d="M6.5 4v12l9.5-6z" />
          )}
        </svg>
      </button>
      <span className="w-[4.75rem] shrink-0 text-sm font-medium tabular-nums">
        {time}
      </span>
      <input
        className="sim-range min-w-0 flex-1"
        type="range"
        min={min}
        max={max}
        step={step}
        value={minute}
        style={
          {
            "--fill": `${((minute - min) / (max - min)) * 100}%`,
          } as CSSProperties
        }
        aria-label="Time of day"
        aria-valuetext={time}
        onChange={(event) => onSeek(Number(event.target.value))}
      />
      <button
        type="button"
        aria-label={`Speed ${speed}×`}
        title="Change speed"
        onClick={() =>
          onSpeed(speeds[(speeds.indexOf(speed) + 1) % speeds.length])
        }
        className="w-11 shrink-0 rounded-full py-1.5 text-xs font-medium text-white/60 tabular-nums transition hover:bg-white/10 hover:text-white"
      >
        {speed}×
      </button>
    </section>
  );
}

function Stat({
  label,
  value,
  accent,
}: {
  label: string;
  value: string;
  accent?: boolean;
}) {
  return (
    <div className="px-6 py-5">
      <dt className="text-xs text-white/40">{label}</dt>
      <dd
        className={`mt-1.5 text-3xl font-semibold tracking-tight tabular-nums ${accent ? "text-emerald-300" : ""}`}
      >
        {value}
      </dd>
    </div>
  );
}

function Live({
  label,
  value,
  warn,
}: {
  label: string;
  value: number;
  warn?: boolean;
}) {
  return (
    <div>
      <p
        className={`text-2xl font-semibold tabular-nums ${warn ? "text-rose-300" : ""}`}
      >
        {value}
      </p>
      <p className="text-[11px] text-white/40">{label}</p>
    </div>
  );
}

function Row({
  label,
  value,
  strong,
}: {
  label: string;
  value: string;
  strong?: boolean;
}) {
  return (
    <div className="flex justify-between gap-4">
      <dt className="text-white/40">{label}</dt>
      <dd
        className={`tabular-nums ${strong ? "font-semibold" : "text-white/75"}`}
      >
        {value}
      </dd>
    </div>
  );
}
