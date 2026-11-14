"use client";

import dynamic from "next/dynamic";
import { useEffect, useState } from "react";
import { replayAt } from "../replay/replay-state";
import type { DemoData, demoPlan } from "./fixture";

const Neighborhood = dynamic(() => import("./neighborhood"), { ssr: false });
const Scene = dynamic(() => import("./scene"), { ssr: false });
const usd = new Intl.NumberFormat("en-US", {
  style: "currency",
  currency: "USD",
  maximumFractionDigits: 0,
});

export function SimulatorDemo({
  data,
  plan,
  coordinates,
}: {
  data: DemoData;
  plan: typeof demoPlan;
  coordinates?: { longitude: number; latitude: number; tilesetUrl: string };
}) {
  const { openMin, closeMin } = data[0].run.metrics;
  const start = coordinates ? 0 : openMin;
  const end = coordinates ? 1440 : closeMin;
  const [minute, setMinute] = useState(coordinates ? 360 : openMin);
  const [playing, setPlaying] = useState(false);
  const [speed, setSpeed] = useState(1);
  const [cutaway, setCutaway] = useState(false);
  const [selected, select] = useState("");
  const running = playing && minute < end;

  useEffect(() => {
    if (!running) return;
    let previous = performance.now();
    let request = 0;
    function tick(now: number) {
      const elapsed = Math.min(now - previous, 100);
      previous = now;
      setMinute((value) =>
        Math.min(end, value + (elapsed * speed) / (coordinates ? 55 : 125)),
      );
      request = requestAnimationFrame(tick);
    }
    request = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(request);
  }, [running, end, speed, coordinates]);

  const time = `${Math.floor(minute / 60)}:${String(Math.floor(minute % 60)).padStart(2, "0")}`;
  const arrivals = replayAt(data[0].run.events, minute).arrivals;
  return (
    <>
      {coordinates ? (
        <Neighborhood {...coordinates} minute={minute}>
          <section
            aria-label="Neighborhood timeline"
            className="absolute bottom-10 left-3 right-3 z-10 rounded-xl bg-ink/95 p-3 text-white sm:left-1/2 sm:w-[min(46rem,95vw)] sm:-translate-x-1/2"
          >
            <div className="flex flex-wrap items-center gap-3">
              <button
                type="button"
                className="rounded bg-white px-4 py-2 font-semibold text-ink"
                onClick={() => {
                  if (minute >= end) setMinute(start);
                  setPlaying(!running);
                }}
              >
                {running ? "Pause" : minute >= end ? "Replay" : "Play"}
              </button>
              <strong className="font-mono">{time} Houston</strong>
              <label className="ml-auto text-sm">
                Speed{" "}
                <select
                  className="rounded bg-ink"
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
            </div>
            <input
              className="mt-2 w-full accent-emerald-300"
              type="range"
              min={start}
              max={end}
              step={1}
              value={Math.floor(minute)}
              aria-label="Time of day"
              aria-valuetext={time}
              onChange={(event) => {
                setPlaying(false);
                setMinute(Number(event.target.value));
              }}
            />
            <div className="flex justify-between text-xs text-emerald-100">
              <span>Midnight</span>
              <span>6 a.m.</span>
              <span>Noon</span>
              <span>6 p.m.</span>
              <span>Midnight</span>
            </div>
          </section>
        </Neighborhood>
      ) : (
        <p
          role="status"
          className="m-4 rounded-xl border border-line bg-white p-4"
        >
          Vexcel neighborhood unavailable. The operating replay is below.
        </p>
      )}
      <main
        id="operating-plan"
        className="mx-auto max-w-7xl space-y-6 p-5 sm:p-8"
      >
        {coordinates && (
          <a
            href="#neighborhood"
            className="text-sm font-semibold text-pine underline"
          >
            Back to neighborhood
          </a>
        )}
        <header>
          <p className="text-sm text-muted">
            Houston coffee shop · Synthetic operating scenario
          </p>
          <h1 className="mt-2 text-3xl font-semibold sm:text-4xl">
            Does a second service station pay off?
          </h1>
          <p className="mt-2 text-muted">
            Both scenarios use the same 110 customer arrivals and draws. The
            alternative adds one staffed station and $6,000 in modeled buildout.
          </p>
        </header>
        <section className="rounded-xl border border-line bg-white p-4">
          <h2 className="text-xl font-semibold">Operating plan</h2>
          <p className="mt-2">
            {plan.concept} · {plan.area.toLocaleString("en-US")} sq ft · 8 a.m.
            to noon
          </p>
          <p className="mt-1 text-sm text-muted">
            Illustrative inputs: {usd.format(plan.rentPerSquareFoot)}/sq ft/year
            asking rent, {usd.format(plan.ticket)} average ticket,{" "}
            {usd.format(plan.wage)}/hour labor, and{" "}
            {usd.format(plan.baselineBuildout)} versus{" "}
            {usd.format(plan.alternativeBuildout)} buildout.
          </p>
          <p className="mt-1 text-sm text-muted">
            CoStar listing and approved project plan are unavailable in this
            worktree.
          </p>
        </section>
        <section
          aria-label="Shared playback"
          className="flex flex-wrap items-center gap-4 rounded-xl border border-line bg-white p-4"
        >
          <button
            className="rounded bg-pine px-4 py-2 text-white"
            onClick={() => {
              if (minute >= closeMin || minute < openMin) {
                setMinute(openMin);
                setPlaying(true);
                return;
              }
              setPlaying(!running);
            }}
          >
            {running ? "Pause" : minute >= closeMin ? "Replay" : "Play"}
          </button>
          <label>
            Speed{" "}
            <select
              value={speed}
              onChange={(event) => setSpeed(Number(event.target.value))}
            >
              {[0.5, 1, 2, 4].map((rate) => (
                <option value={rate} key={rate}>
                  {rate}×
                </option>
              ))}
            </select>
          </label>
          <label className="flex min-w-40 flex-1 items-center gap-2">
            Time{" "}
            <input
              className="flex-1"
              type="range"
              min={openMin}
              max={closeMin}
              step={0.01}
              value={Math.min(closeMin, Math.max(openMin, minute))}
              aria-valuetext={time}
              onChange={(event) => {
                setPlaying(false);
                setMinute(Number(event.target.value));
              }}
            />{" "}
            {time}
          </label>
          <label className="flex items-center gap-2">
            <input
              type="checkbox"
              checked={cutaway}
              onChange={(event) => setCutaway(event.target.checked)}
            />{" "}
            Focus on shop
          </label>
        </section>
        <div className="grid gap-4 lg:grid-cols-2">
          {data.map(({ run, monthly }, index) => {
            const frame = replayAt(run.events, minute);
            const customer = frame.arrivals.get(selected);
            return (
              <section
                key={run.metrics.stations}
                className="overflow-hidden rounded-xl border border-line bg-white"
              >
                <h2 className="px-4 py-3 text-lg font-semibold">
                  {index === 0 ? "Current plan" : "Alternative"} ·{" "}
                  {run.metrics.stations} {index === 0 ? "station" : "stations"}
                </h2>
                <div className="h-80" aria-label="Modeled block and café">
                  <Scene
                    run={run}
                    minute={minute}
                    cutaway={cutaway}
                    selected={selected}
                    select={select}
                  />
                </div>
                <div className="space-y-2 p-4 text-sm">
                  <p>
                    {frame.served} served · {frame.waiting.length} waiting ·{" "}
                    {frame.left} left
                  </p>
                  <p>
                    Day-end: {run.metrics.served} served ·{" "}
                    {run.metrics.abandoned} left ·{" "}
                    {usd.format(run.metrics.revenueUsd)} revenue
                  </p>
                  <p>
                    Modeled month: {usd.format(monthly.revenueUsd)} revenue ·{" "}
                    {usd.format(monthly.costs.totalUsd)} included costs ·{" "}
                    <strong>
                      {usd.format(monthly.contributionUsd)} after included costs
                    </strong>
                  </p>
                  {selected && (
                    <p>
                      {selected}:{" "}
                      {customer
                        ? `${customer.lineLength} waiting at arrival · ${Math.round(customer.stayProbability * 100)}% modeled join probability · ${customer.decision === "join" ? "joined" : "left"}`
                        : "Approaching or has yet to arrive"}
                    </p>
                  )}
                </div>
              </section>
            );
          })}
        </div>
        <label className="block">
          Inspect a customer{" "}
          <select
            className="rounded border border-line bg-white p-2"
            value={arrivals.has(selected) ? selected : ""}
            onChange={(event) => select(event.target.value)}
          >
            <option value="">Choose an arrival</option>
            {[...arrivals.keys()].map((id) => (
              <option key={id}>{id}</option>
            ))}
          </select>
        </label>
        <p className="text-sm text-muted">
          The block and vehicle movement are illustrative. Walking paths
          visualize scheduled arrivals. Monthly totals repeat the representative
          weekday 22 times and include ingredients, labor, rent, and buildout
          amortization. Taxes and other overhead are excluded.
        </p>
      </main>
    </>
  );
}
