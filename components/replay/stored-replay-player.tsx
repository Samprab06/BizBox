"use client";

import dynamic from "next/dynamic";
import { useEffect, useMemo, useState } from "react";
import type { SiteRun } from "@/lib/contracts";
import type { RepresentativeRun } from "@/lib/contracts/evaluation";
import {
  orderedStoredEvents,
  storedReplayAt,
  storedReplayBounds,
  storedReplayStations,
} from "./stored-replay-state";

const FloorPlan = dynamic(() => import("./floor-plan"), {
  ssr: false,
  loading: () => <p className="p-4">Loading layout…</p>,
});
const percent = new Intl.NumberFormat("en-US", {
  style: "percent",
  maximumFractionDigits: 1,
});
const decimal = new Intl.NumberFormat("en-US", { maximumFractionDigits: 1 });
const eventLabels: Record<SiteRun["events"][number]["type"], string> = {
  arrived: "Arrived",
  joined: "Joined the queue",
  served: "Started service",
  departed: "Completed service",
  abandoned: "Left without service",
};
const clock = (minute: number) => {
  const whole = Math.floor(minute);
  return `${String(Math.floor(whole / 60)).padStart(2, "0")}:${String(whole % 60).padStart(2, "0")}`;
};

export function StoredReplayPlayer({
  run,
  representative,
}: {
  run: SiteRun;
  representative: RepresentativeRun;
}) {
  const events = useMemo(() => orderedStoredEvents(run.events), [run.events]);
  const { openMin, closeMin } = useMemo(
    () => storedReplayBounds(events, representative.hourly),
    [events, representative.hourly],
  );
  const stations = useMemo(() => storedReplayStations(events), [events]);
  const [time, setTime] = useState(openMin);
  const [speed, setSpeed] = useState(1);
  const [playing, setPlaying] = useState(false);
  const [selected, setSelected] = useState("");
  const frame = useMemo(() => storedReplayAt(events, time), [events, time]);
  const history =
    selected && frame.arrivals.includes(selected)
      ? events.filter(
          (event) => event.customerId === selected && event.minute <= time,
        )
      : [];
  const arrival = history.find((event) => event.type === "arrived")?.arrival;
  const persona = run.replayPersonas?.find(
    (entry) => entry.id === arrival?.personaId,
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
    <div className="min-w-0 space-y-4">
      <p className="text-sm text-muted">
        Recorded simulation events, not observed customer movements. Service
        lanes are schematic and reflect concurrent service; this is not a
        measured floor plan.
      </p>
      <div
        className="h-72 overflow-hidden rounded-xl border border-line bg-canvas"
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
          className="rounded-lg bg-accent hover:bg-accent-hover px-4 py-2 font-semibold text-on-accent"
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
      <p className="text-xs text-muted">
        Playback window inferred from stored hourly statistics and event times.
      </p>
      <p className="text-sm text-muted" aria-label="Replay counts">
        {frame.waiting.length} waiting · {frame.serving.length} in service ·{" "}
        {frame.served} served · {frame.left} left
      </p>
      {!events.length && (
        <p role="status">
          This representative run has no recorded customer events.
        </p>
      )}
      <label className="grid max-w-sm gap-1 text-sm font-medium">
        Inspect a customer
        <select
          className="min-w-0 rounded-lg border border-line p-2"
          value={history.length ? selected : ""}
          onChange={(event) => setSelected(event.target.value)}
        >
          <option value="">Choose an arrival</option>
          {frame.arrivals.map((id) => (
            <option key={id} value={id}>
              {id.replace("customer-", "Customer ")}
            </option>
          ))}
        </select>
      </label>
      {history.length > 0 && (
        <section
          aria-label="Stored customer events"
          className="rounded-xl border border-line p-4 text-sm break-words"
        >
          <h3 className="font-semibold">Customer {selected}</h3>
          <ol className="mt-2 space-y-1">
            {history.map((event, index) => (
              <li key={index}>
                {clock(event.minute)} · {eventLabels[event.type]}
              </li>
            ))}
          </ol>
          {arrival ? (
            <dl className="mt-3 space-y-2">
              <div>
                <dt className="font-semibold">Persona</dt>
                <dd>{persona?.segment ?? arrival.personaId}</dd>
              </div>
              <div>
                <dt className="font-semibold">Stay probability at arrival</dt>
                <dd>
                  {percent.format(arrival.stayProbability)} with{" "}
                  {arrival.lineLength} in line
                </dd>
              </div>
              {persona?.jev ? (
                <>
                  <div>
                    <dt className="font-semibold">Jev panel choice shares</dt>
                    <dd>
                      <ul>
                        {Object.entries(persona.jev.where).map(
                          ([location, share]) => (
                            <li key={location}>
                              {location === run.siteId ? "This site" : location}{" "}
                              · {percent.format(share)}
                            </li>
                          ),
                        )}
                      </ul>
                    </dd>
                  </div>
                  <div>
                    <dt className="font-semibold">
                      Jev panel visits per month
                    </dt>
                    <dd>{decimal.format(persona.jev.visitsPerMonth)}</dd>
                  </div>
                </>
              ) : (
                <div>
                  <dt className="font-semibold">Jev panel</dt>
                  <dd className="text-muted">
                    No Jev panel answers were used for this persona in this run.
                  </dd>
                </div>
              )}
            </dl>
          ) : (
            <p className="mt-3 text-muted">
              Persona details and choice probabilities are not retained in these
              stored events.
            </p>
          )}
        </section>
      )}
      <details className="min-w-0 rounded-xl border border-line p-4">
        <summary className="cursor-pointer font-semibold">
          Representative hourly statistics
        </summary>
        <div className="mt-3 overflow-x-auto">
          <table className="w-full text-left text-sm">
            <caption className="mb-2 text-left text-muted">
              One seeded {run.dayType} scenario; these counts are simulated
              outcomes.
            </caption>
            <thead>
              <tr>
                {[
                  "Hour",
                  "Arrivals",
                  "Served",
                  "Left",
                  "Mean wait",
                  "Utilization",
                ].map((label) => (
                  <th className="p-2" scope="col" key={label}>
                    {label}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {representative.hourly.map((row) => (
                <tr key={row.hour} className="border-t border-line">
                  <th className="p-2 font-normal" scope="row">
                    {clock(row.hour * 60)}
                  </th>
                  <td className="p-2">{row.arrivals}</td>
                  <td className="p-2">{row.served}</td>
                  <td className="p-2">{row.abandoned}</td>
                  <td className="p-2">
                    {row.meanWaitMin === null
                      ? "Unknown"
                      : `${decimal.format(row.meanWaitMin)} min`}
                  </td>
                  <td className="p-2">{percent.format(row.utilization)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </details>
    </div>
  );
}
