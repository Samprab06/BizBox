"use client";

import dynamic from "next/dynamic";
import { useEffect, useState } from "react";
import type { CSSProperties } from "react";
import { replayAt } from "../replay/replay-state";
import type { DemoData, demoPlan } from "./fixture";
import type { SimulatorStory } from "./stored";
import { DecisionHeader } from "@/components/decision/decision-header";
import { simulatorAnswer } from "@/components/decision/simulator-answer";
import {
  SENSITIVITY_ASSUMPTIONS,
  type RobustnessSummary,
} from "@/lib/contracts/evaluation";
import { Card } from "@/components/ui/card";
import { EvidenceBadge } from "@/components/ui/evidence-badge";
import { GlassControl } from "@/components/ui/glass-control";
import { useWorkspaceReport } from "@/lib/client/use-workspace-context";
import type { WorkspaceObservation } from "@/lib/client/workspace-context";
import { SimulatorViewport } from "./viewport";
import { customerLabel } from "./customer-label";
import type { RenderQuality } from "./render-policy";
import type { SiteInsights } from "@/lib/contracts/insights";
import { InsightsDrawer } from "@/components/insights/insights-drawer";
import {
  playbackSpeeds,
  StatsCard,
  type PlaybackSpeed,
} from "@/components/city/stats-card";

const Neighborhood = dynamic(() => import("./neighborhood"), { ssr: false });
const Scene = dynamic(() => import("./scene"), { ssr: false });
const usd = new Intl.NumberFormat("en-US", {
  style: "currency",
  currency: "USD",
  maximumFractionDigits: 0,
});
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
  scenarioLabels: ["Baseline", "Alternative"],
  compare: true,
  footnote:
    "Example data, not a researched property: 110 generated customers at a fixture site. Illustrative block and vehicles. Monthly totals repeat one weekday 22 times and include ingredients, labor, rent and buildout amortization; taxes and other overhead are excluded.",
};

export function SimulatorDemo({
  data,
  plan,
  coordinates,
  story = EXAMPLE_STORY,
  projectId,
  context,
  robustness,
  outdated = false,
  profileVersionUnknown = false,
  insights,
  insightsUnavailableReason,
  profileVersion,
}: {
  projectId: string;
  robustness?: RobustnessSummary | null;
  outdated?: boolean;
  profileVersionUnknown?: boolean;
  insights?: SiteInsights;
  insightsUnavailableReason?: string;
  profileVersion?: number;
  context: Extract<WorkspaceObservation, { kind: "simulator" }>;
  data: DemoData;
  plan: typeof demoPlan;
  coordinates?: { longitude: number; latitude: number; tilesetUrl: string };
  /** Copy and provenance; defaults to the labelled example. */
  story?: SimulatorStory;
}) {
  useWorkspaceReport(projectId, context);
  const { openMin, closeMin } = data[0].run.metrics;
  const start = coordinates ? 0 : openMin;
  const end = coordinates ? 1440 : closeMin;
  const [minute, setMinute] = useState(
    data[0].run.events.find((event) => event.type === "service_start")
      ?.timeMin ?? openMin,
  );
  const [previewIndex, setPreviewIndex] = useState(0);
  const [playing, setPlaying] = useState(false);
  const [speed, setSpeed] = useState<PlaybackSpeed>(1);
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
  const previewRun = data[previewIndex].run;
  const previewMinute = Math.min(
    previewRun.metrics.closeMin,
    Math.max(previewRun.metrics.openMin, minute),
  );
  const previewFrame = replayAt(previewRun.events, previewMinute);
  const insightsControl = (
    <InsightsDrawer
      projectId={projectId}
      siteId={context.siteId ?? base.run.siteId}
      comparisonId={context.comparisonId}
      data={context.phase === "ready" ? insights : undefined}
      unavailableReason={
        context.phase === "example"
          ? "This simulator example retains one seeded day, not the multi-seed insights dataset. Cross-seed insights are unavailable for this example."
          : insightsUnavailableReason
      }
      onOpen={() => setPlaying(false)}
      outdated={outdated}
      profileVersionUnknown={profileVersionUnknown}
      profileVersion={profileVersion}
      synthetic={context.synthetic}
    />
  );

  return (
    <div className="min-w-0 space-y-5">
      <DecisionHeader
        compact
        decision={
          story.compare
            ? "Does a second staffed station pay off?"
            : "Which site holds its lead?"
        }
        answer={simulatorAnswer({
          example: context.phase === "example",
          additionalServed: alternative
            ? alternative.run.metrics.served - base.run.metrics.served
            : 0,
          contributionChange: gain,
          robustness,
        })}
        qualification={
          <>
            <p>
              <EvidenceBadge kind="Simulation" />{" "}
              {context.phase === "ready" && context.synthetic
                ? "Example · "
                : ""}
              {story.eyebrow} · Modeled, not a forecast.
            </p>
            {context.phase === "example" && (
              <p>One seeded example; demand robustness has not been tested.</p>
            )}
            {profileVersionUnknown && (
              <p role="status" className="text-warn">
                The current profile version could not be checked; this answer
                uses a saved snapshot.
              </p>
            )}
            {outdated && (
              <p role="status" className="font-semibold text-warn">
                Outdated comparison: these conditions use an earlier profile
                snapshot.
              </p>
            )}
            {robustness?.jevHuffAgree === false && (
              <p>Jev and Huff disagree on the leader; ranking is uncertain.</p>
            )}
            {robustness && (
              <details>
                <summary className="cursor-pointer font-semibold text-pine">
                  Decision evidence
                </summary>
                {robustness.robustTo.length > 0 && (
                  <p>
                    The lead holds across tested changes in{" "}
                    {robustness.robustTo
                      .map((value) => value.replaceAll("_", " "))
                      .join(", ")}
                    .
                  </p>
                )}
                <ul>
                  {robustness.missingInformation.map((item) => (
                    <li key={item}>{item}</li>
                  ))}
                </ul>
              </details>
            )}
          </>
        }
        scene={
          <section aria-label="Decision scene" className="min-w-0 space-y-1">
            <div className="flex min-w-0 items-center gap-2">
              <select
                aria-label="Decision replay scenario"
                value={previewIndex}
                onChange={(event) => {
                  const index = Number(event.target.value);
                  setPreviewIndex(index);
                  setPlaying(false);
                  setMinute(
                    data[index].run.events.find(
                      (item) => item.type === "service_start",
                    )?.timeMin ?? data[index].run.metrics.openMin,
                  );
                }}
                className="min-w-0 rounded border border-muted bg-surface p-1 text-xs text-ink"
              >
                {data.map((_, index) => (
                  <option key={index} value={index}>
                    {story.compare
                      ? story.scenarioLabels[index]
                      : `Baseline · ${story.scenarioLabels[index]}`}
                  </option>
                ))}
              </select>
              <input
                aria-label="Decision operating replay time"
                aria-valuetext={clock(previewMinute)}
                type="range"
                min={previewRun.metrics.openMin}
                max={previewRun.metrics.closeMin}
                value={previewMinute}
                step="0.01"
                className="min-w-0 flex-1 accent-pine"
                onChange={(event) => {
                  setPlaying(false);
                  setMinute(Number(event.target.value));
                }}
              />
              <a
                href="#operating-plan"
                className="shrink-0 text-xs font-semibold text-pine underline"
              >
                Full replay
              </a>
            </div>
            <SimulatorViewport
              label="Decision operating replay"
              className="h-40"
            >
              <Scene
                quality={quality}
                run={data[previewIndex].run}
                minute={previewMinute}
                cutaway
                cameraZoom={22}
                selected={selected}
                select={select}
              />
            </SimulatorViewport>
            <p className="text-xs text-muted">
              Schematic replay · {clock(previewMinute)} ·{" "}
              {previewFrame.waiting.length} waiting ·{" "}
              {previewFrame.serving.length} in service
            </p>
          </section>
        }
        nextAction={
          context.comparisonId &&
          robustness?.mostInfluential &&
          SENSITIVITY_ASSUMPTIONS.some(
            (value) => value === robustness.mostInfluential!.assumption,
          ) &&
          !outdated ? (
            <a
              className="rounded-lg bg-pine px-4 py-2 font-semibold text-on-pine"
              href={`/projects/${encodeURIComponent(projectId)}/comparison?${new URLSearchParams({ comparison: context.comparisonId, sensitivity: robustness.mostInfluential.assumption, ...(context.siteId ? { site: context.siteId } : {}) })}#comparison-sensitivity`}
            >
              Change{" "}
              {
                (
                  {
                    market_share_scale: "market share",
                    visit_frequency: "visit frequency",
                    ticket_size: "average ticket",
                    rent: "rent",
                    price: "price",
                  } as Record<string, string>
                )[robustness.mostInfluential.assumption]
              }
            </a>
          ) : (
            <a
              href="#simulator-decision-evidence"
              className="rounded-lg bg-pine px-4 py-2 font-semibold text-on-pine"
            >
              Open assumptions and evidence
            </a>
          )
        }
      />
      <Card id="simulator-decision-evidence" tabIndex={-1}>
        <p className="text-sm text-muted">
          {story.intro ||
            `Same 110 modeled customers, same draws. One extra staffed station and ${usd.format(plan.alternativeBuildout - plan.baselineBuildout)} more buildout.`}
        </p>
        <p className="mt-2 text-xs text-muted">{story.footnote}</p>
      </Card>

      {coordinates ? (
        <SimulatorViewport
          label="3D neighborhood"
          className="h-[40rem] max-h-[80dvh] min-h-[32rem]"
        >
          <Neighborhood
            {...coordinates}
            minute={minute}
            quality={quality}
            locationLabel={context.siteId ?? "Selected location"}
            controls={
              <div>
                <label className="flex flex-wrap items-center gap-2 text-xs">
                  Graphics
                  <select
                    aria-label="Graphics quality"
                    value={quality}
                    onChange={(event) =>
                      setQuality(event.target.value as RenderQuality)
                    }
                    className="rounded border border-viewport-muted bg-viewport-surface p-2 text-viewport-ink"
                  >
                    <option value="balanced">Balanced</option>
                    <option value="detailed">Detailed</option>
                  </select>
                </label>
                {insightsControl}
              </div>
            }
          >
            <Timeline
              label="Neighborhood timeline"
              floating
              className="absolute inset-x-3 bottom-8 z-10"
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
        </SimulatorViewport>
      ) : (
        <Card>
          <p role="status" className="text-sm text-muted">
            3D neighborhood unavailable. The modeled operating replay is
            available below.
          </p>
          {insightsControl}
        </Card>
      )}

      {story.compare && alternative && (
        <Card className="grid gap-5 sm:grid-cols-3">
          <dl>
            <Stat
              label="Modeled monthly contribution change"
              value={`${gain >= 0 ? "+" : "−"}${usd.format(Math.abs(gain))}`}
            />
            <dd className="mt-2">
              <details className="text-sm text-muted">
                <summary className="cursor-pointer underline underline-offset-4">
                  Time basis and included costs
                </summary>
                <p className="mt-2">
                  22 weekdays · ingredients, labor, rent, buildout amortization.
                  Taxes and other overhead excluded.
                </p>
              </details>
            </dd>
          </dl>
          <dl>
            <Stat
              label="Modeled customers retained / weekday"
              value={`${kept >= 0 ? "+" : "−"}${Math.abs(kept)}`}
            />
          </dl>
          <dl>
            <Stat
              label="Extra buildout"
              value={usd.format(
                plan.alternativeBuildout - plan.baselineBuildout,
              )}
            />
          </dl>
        </Card>
      )}

      <ul className="flex flex-wrap gap-2 text-xs text-muted">
        {[
          `${plan.area.toLocaleString("en-US")} sq ft`,
          `${clock(openMin)} – ${clock(closeMin)}`,
          `${usd.format(plan.rentPerSquareFoot)}/sq ft/yr rent`,
          `${usd.format(plan.ticket)} ticket`,
          `${usd.format(plan.wage)}/hr labor`,
        ].map((chip) => (
          <li
            key={chip}
            className="rounded border border-line bg-surface px-3 py-2"
          >
            {chip}
          </li>
        ))}
      </ul>

      <section
        id="operating-plan"
        aria-label="Operating replay"
        className="scroll-mt-4 space-y-4"
      >
        <div className="flex flex-wrap gap-2">
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
            className="rounded-lg border border-pine bg-surface px-4 py-3 text-sm font-medium text-pine aria-pressed:bg-mint"
          >
            Focus on shop
          </button>
        </div>
        <StatsCard
          run={previewRun}
          runLabel={story.scenarioLabels[previewIndex]}
          scope="site"
          minute={previewMinute}
          playing={running}
          speed={speed}
          onScopeChange={() => {}}
          onMinuteChange={(value) => {
            setPlaying(false);
            setMinute(value);
          }}
          onPlayingChange={(value) => {
            if (
              value &&
              (minute < previewRun.metrics.openMin ||
                minute >= previewRun.metrics.closeMin)
            ) {
              setMinute(previewRun.metrics.openMin);
            }
            setPlaying(value);
          }}
          onSpeedChange={setSpeed}
        />
        <div className="grid gap-4 lg:grid-cols-2">
          {data.map(({ run, monthly }, index) => {
            const frame = replayAt(run.events, minute);
            const customer = frame.arrivals.get(selected);
            const scenario =
              story.compare && index === 1 ? "alternative" : "baseline";
            return (
              <Card key={index} className="!p-4">
                <header className="mb-3 flex flex-wrap items-baseline justify-between gap-2">
                  <h2
                    className={`font-semibold ${scenario === "baseline" ? "text-baseline" : "text-alternative"}`}
                  >
                    {story.compare
                      ? story.scenarioLabels[index]
                      : `Baseline · ${story.scenarioLabels[index]}`}
                  </h2>
                  <span className="text-xs text-muted">
                    {run.metrics.stations}{" "}
                    {run.metrics.stations === 1 ? "station" : "stations"}
                  </span>
                </header>
                <SimulatorViewport
                  label={`${story.scenarioLabels[index]} modeled café`}
                  className="h-72"
                >
                  <Scene
                    quality={quality}
                    run={run}
                    minute={minute}
                    cutaway={cutaway}
                    selected={selected}
                    select={select}
                  />
                </SimulatorViewport>
                <div className="grid grid-cols-2 gap-3 pt-4 sm:grid-cols-4">
                  <Live label="Modeled arrivals" value={frame.arrivals.size} />
                  <Live label="Served" value={frame.served} />
                  <Live label="Waiting" value={frame.waiting.length} />
                  <Live label="Left" value={frame.left} warn={frame.left > 0} />
                </div>
                <dl className="mt-4 space-y-2 text-sm">
                  <Row
                    label="Modeled day-end"
                    value={`${run.metrics.served} served · ${run.metrics.abandoned} left`}
                  />
                  <Row
                    label="Modeled monthly revenue"
                    value={usd.format(monthly.revenueUsd)}
                  />
                  <Row
                    label="Modeled monthly contribution"
                    value={usd.format(monthly.contributionUsd)}
                    strong
                  />
                </dl>
                {selected && (
                  <p className="mt-3 rounded-lg bg-paper p-3 text-xs text-muted">
                    {selected} ·{" "}
                    {customer
                      ? customerLabel(customer, !story.compare)
                      : "not arrived yet"}
                  </p>
                )}
              </Card>
            );
          })}
        </div>
        <label className="flex flex-wrap items-center justify-end gap-2 text-sm text-muted">
          Modeled customer
          <select
            aria-label="Inspect a customer"
            className="max-w-full rounded-lg border border-muted bg-surface px-3 py-2 text-ink"
            value={arrivals.has(selected) ? selected : ""}
            onChange={(event) => select(event.target.value)}
          >
            <option value="">
              {arrivals.size ? "Inspect a customer" : "No modeled arrivals yet"}
            </option>
            {[...arrivals.keys()].map((id) => (
              <option key={id}>{id}</option>
            ))}
          </select>
        </label>
      </section>
      {story.provenance && (
        <Card role="region" aria-label="Recorded run provenance">
          <h2 className="font-medium">{story.provenance.label}</h2>
          <ul className="mt-2 space-y-1 text-xs text-muted">
            {story.provenance.items.map((item) => (
              <li key={item}>{item}</li>
            ))}
          </ul>
        </Card>
      )}
      <p className="max-w-2xl text-xs leading-relaxed text-muted">
        {story.footnote}
      </p>
    </div>
  );
}

function Timeline({
  label,
  className,
  floating = false,
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
  floating?: boolean;
  minute: number;
  min: number;
  max: number;
  step: number;
  running: boolean;
  ended: boolean;
  speed: PlaybackSpeed;
  onSpeed: (speed: PlaybackSpeed) => void;
  onToggle: () => void;
  onSeek: (minute: number) => void;
}) {
  const time = clock(minute);
  const action = running ? "Pause" : ended ? "Replay" : "Play";
  const content = (
    <>
      <button
        type="button"
        aria-label={action}
        title={action}
        onClick={onToggle}
        className="grid size-11 shrink-0 place-items-center rounded-full bg-pine text-on-pine hover:opacity-90"
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
          onSpeed(
            playbackSpeeds[
              (playbackSpeeds.indexOf(speed) + 1) % playbackSpeeds.length
            ],
          )
        }
        className="w-11 shrink-0 rounded-full py-1.5 text-xs font-medium tabular-nums hover:bg-mint"
      >
        {speed}×
      </button>
    </>
  );
  const classes = `flex items-center gap-2 !p-2 ${className}`;
  return floating ? (
    <GlassControl over="viewport" aria-label={label} className={classes}>
      {content}
    </GlassControl>
  ) : (
    <Card role="group" aria-label={label} className={classes}>
      {content}
    </Card>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <>
      <dt className="text-xs text-muted">{label}</dt>
      <dd
        className={`mt-1.5 text-3xl font-semibold tracking-tight tabular-nums text-ink`}
      >
        {value}
      </dd>
    </>
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
        className={`text-2xl font-semibold tabular-nums ${warn ? "text-danger" : ""}`}
      >
        {value}
      </p>
      <p className="text-xs text-muted">{label}</p>
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
      <dt className="text-muted">{label}</dt>
      <dd className={`tabular-nums ${strong ? "font-semibold" : "text-ink"}`}>
        {value}
      </dd>
    </div>
  );
}
