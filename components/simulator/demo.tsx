"use client";

import dynamic from "next/dynamic";
import { useEffect, useState } from "react";
import type { CSSProperties } from "react";
import { replayAt } from "../replay/replay-state";
import { interiorFrame } from "./interior-state";
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
import { InspectPanel } from "@/components/city/inspect-panel";
import type { RenderQuality } from "./render-policy";
import type { SiteInsights } from "@/lib/contracts/insights";
import { InsightsDrawer } from "@/components/insights/insights-drawer";
import type { MatterportConfig } from "../interior/matterport-view";

const Neighborhood = dynamic(() => import("./neighborhood"), { ssr: false });
const Scene = dynamic(() => import("./scene"), { ssr: false });
const MatterportView = dynamic(() => import("../interior/matterport-view"), {
  ssr: false,
});
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
  eyebrow: "Example · Toy data · Houston coffee shop",
  title: "Does a second staffed counter pay off?",
  intro: "",
  scenarioLabels: ["One staffed counter", "Two staffed counters"],
  compare: true,
  footnote:
    "Example data, not a researched property: 110 generated customers at a fixture site. Modeled layout, not a Matterport scan. Dot travel paths are illustrative two-minute entry/exit animations, not measured walking or collision simulation. Monthly totals repeat one weekday 22 times and include ingredients, labor, rent and buildout amortization; taxes and other overhead are excluded.",
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
  matterport,
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
  /** Public-demo scan only; the SDK key is client-permitted and domain-restricted. */
  matterport?: MatterportConfig;
}) {
  useWorkspaceReport(projectId, context);
  const { openMin, closeMin } = data[0].run.metrics;
  const start = coordinates ? 0 : openMin;
  const end = coordinates ? 1440 : closeMin;
  const [minute, setMinute] = useState(
    matterport
      ? Math.min(closeMin, openMin + 24)
      : (data[0].run.events.find((event) => event.type === "service_start")
          ?.timeMin ?? openMin),
  );
  const [previewIndex, setPreviewIndex] = useState(0);
  const [playing, setPlaying] = useState(false);
  // Both views share a clock; the controller that starts it chooses its stop.
  const [playbackEnd, setPlaybackEnd] = useState(end);
  const [speed, setSpeed] = useState(1);
  const [cutaway, setCutaway] = useState(false);
  const [selected, select] = useState("");
  const [inspectIndex, setInspectIndex] = useState(0);
  const [quality, setQuality] = useState<RenderQuality>("balanced");
  const [interiorMode, setInteriorMode] = useState<"scan" | "modeled">(
    matterport ? "scan" : "modeled",
  );
  const [activePlan, setActivePlan] = useState(0);
  const running = playing && minute < playbackEnd;

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
            playbackEnd,
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
  }, [running, playbackEnd, speed, coordinates]);

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
                selected={selected}
                select={select}
                employeeCount={data[previewIndex].staffing?.headcount}
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
                setPlaybackEnd(end);
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
        <div
          className="flex flex-wrap items-center gap-x-5 gap-y-2 text-xs text-muted"
          aria-label="Dot legend"
        >
          <span className="flex items-center gap-2">
            <span
              aria-hidden
              className="size-3 rounded-full"
              style={{ background: "#60a5fa" }}
            />
            Customer
          </span>
          <span className="flex items-center gap-2">
            <span
              aria-hidden
              className="size-3 rounded-full ring-2 ring-ink ring-offset-2 ring-offset-surface"
              style={{ background: "#c084fc" }}
            />
            Employee · ring
          </span>
          <span>Outline · selected customer</span>
        </div>
        <p className="max-w-2xl text-xs leading-relaxed text-muted">
          Customers approach the same shop, queue, receive service and leave.
          Employee dots mark staffed counters; movement paths illustrate replay
          events. Adding furniture without staffing does not add modeled service
          capacity.
        </p>
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
              setPlaybackEnd(closeMin);
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
            aria-label="Reset shared playback"
            onClick={() => {
              setPlaying(false);
              setPlaybackEnd(closeMin);
              setMinute(openMin);
              select("");
            }}
            className="min-h-11 rounded-lg border border-pine bg-surface px-4 py-3 text-sm font-medium text-pine"
          >
            Reset
          </button>
          {interiorMode === "modeled" && (
            <button
              type="button"
              aria-pressed={cutaway}
              onClick={() => setCutaway(!cutaway)}
              className="rounded-lg border border-pine bg-surface px-4 py-3 text-sm font-medium text-pine aria-pressed:bg-mint"
            >
              Focus on shop
            </button>
          )}
        </div>
        <section
          id="scanned-interior"
          aria-label="Interior view controls"
          className="scroll-mt-24 space-y-3"
        >
          {matterport && (
            <p className="text-xs text-muted">
              Starts paused at {clock(Math.min(closeMin, openMin + 24))}. Play
              the day or reset to opening.
            </p>
          )}
          <div className="flex flex-wrap items-center gap-2">
            <button
              type="button"
              aria-pressed={interiorMode === "scan"}
              disabled={!matterport}
              onClick={() => setInteriorMode("scan")}
              className="min-h-11 rounded-lg border border-pine bg-surface px-4 text-sm font-medium text-pine disabled:opacity-40 aria-pressed:bg-mint"
            >
              Scanned interior
            </button>
            <button
              type="button"
              aria-pressed={interiorMode === "modeled"}
              onClick={() => setInteriorMode("modeled")}
              className="min-h-11 rounded-lg border border-pine bg-surface px-4 text-sm font-medium text-pine aria-pressed:bg-mint"
            >
              Modeled layout
            </button>
          </div>
          {!matterport && (
            <p className="text-xs text-muted">
              Scanned interior is unavailable in this environment. The modeled
              replay is selected.
            </p>
          )}
          {interiorMode === "scan" && matterport && (
            <>
              <div
                role="radiogroup"
                aria-label="Scanned plan"
                className="flex flex-wrap gap-2"
              >
                {data.map((_, index) => (
                  <button
                    key={index}
                    type="button"
                    role="radio"
                    aria-checked={activePlan === index}
                    tabIndex={activePlan === index ? 0 : -1}
                    onClick={() => setActivePlan(index)}
                    onKeyDown={(event) => {
                      const direction =
                        event.key === "ArrowRight" || event.key === "ArrowDown"
                          ? 1
                          : event.key === "ArrowLeft" || event.key === "ArrowUp"
                            ? -1
                            : 0;
                      if (
                        !direction &&
                        event.key !== "Home" &&
                        event.key !== "End"
                      )
                        return;
                      event.preventDefault();
                      const next =
                        event.key === "Home"
                          ? 0
                          : event.key === "End"
                            ? data.length - 1
                            : (index + direction + data.length) % data.length;
                      setActivePlan(next);
                      event.currentTarget.parentElement
                        ?.querySelectorAll<HTMLButtonElement>('[role="radio"]')
                        [next]?.focus();
                    }}
                    className="min-h-11 rounded-lg border border-pine bg-surface px-4 text-sm font-medium text-pine aria-checked:bg-mint"
                  >
                    {story.scenarioLabels[index] ?? `Scenario ${index + 1}`}
                  </button>
                ))}
              </div>
              <MatterportView
                config={matterport}
                run={data[activePlan].run}
                minute={minute}
                employeeCount={data[activePlan].staffing?.headcount}
                selected={selected}
                select={select}
                seek={setMinute}
              />
            </>
          )}
        </section>
        <div className="grid gap-4 lg:grid-cols-2">
          {data.map(({ run, monthly, staffing }, index) => {
            const frame = interiorFrame(run, minute, staffing?.headcount);
            const customer = frame.arrivals.get(selected);
            const scenario =
              story.compare && index === 1 ? "alternative" : "baseline";
            const label =
              story.scenarioLabels[index] ?? `Scenario ${index + 1}`;
            return (
              <Card
                key={index}
                role="region"
                aria-label={label}
                className="min-w-0 !p-4"
              >
                <header className="mb-3 flex flex-wrap items-baseline justify-between gap-2">
                  <h2
                    className={`font-semibold ${scenario === "baseline" ? "text-baseline" : "text-alternative"}`}
                  >
                    {story.compare ? label : `Baseline · ${label}`}
                  </h2>
                  <span className="text-xs text-muted">
                    {run.metrics.stations}{" "}
                    {run.metrics.stations === 1 ? "counter" : "counters"}
                    {staffing
                      ? ` · ${staffing.headcount} ${staffing.headcount === 1 ? "employee" : "employees"}`
                      : " · staffing unavailable"}
                  </span>
                </header>
                {interiorMode === "modeled" && (
                  <>
                    <p className="pb-2 text-xs font-medium text-muted">
                      Modeled layout
                    </p>
                    <SimulatorViewport
                      label={`${label} modeled café`}
                      className="h-72"
                    >
                      <Scene
                        quality={quality}
                        run={run}
                        minute={minute}
                        cutaway={cutaway}
                        selected={selected}
                        select={select}
                        employeeCount={staffing?.headcount}
                      />
                    </SimulatorViewport>
                  </>
                )}
                <dl className="grid grid-cols-2 gap-3 pt-4 sm:grid-cols-5">
                  <Live label="Modeled arrivals" value={frame.arrivals.size} />
                  <Live label="Served" value={frame.served} />
                  <Live label="Waiting" value={frame.waiting.length} />
                  <Live label="Left" value={frame.left} warn={frame.left > 0} />
                  <Live
                    label="Busy counters"
                    value={`${frame.serving.length}/${run.metrics.stations}`}
                  />
                </dl>
                <dl className="mt-4 space-y-2 text-sm">
                  <Row
                    label="Avg wait to service so far"
                    value={
                      frame.meanWaitMin === null
                        ? "No service starts yet"
                        : `${frame.meanWaitMin.toFixed(1)} min`
                    }
                  />
                  <Row
                    label="Modeled day-end"
                    value={`${run.metrics.served} served · ${run.metrics.abandoned} left`}
                  />
                  <Row
                    label="Modeled monthly revenue"
                    value={usd.format(monthly.revenueUsd)}
                  />
                  <Row
                    label="Modeled labor / month"
                    value={usd.format(monthly.costs.laborUsd)}
                  />
                  <Row
                    label="Modeled monthly contribution"
                    value={usd.format(monthly.contributionUsd)}
                    strong
                  />
                </dl>
                <p className="mt-3 text-xs leading-relaxed text-muted">
                  Wait averages customers who have started service by this
                  minute, including those still being served. Served and left
                  are cumulative; waiting and busy counters are current.
                </p>
                {staffing && (
                  <div
                    className="mt-3 flex flex-wrap gap-2"
                    aria-label="Employee inspection"
                  >
                    {Array.from(
                      {
                        length: Math.min(
                          staffing.headcount,
                          run.metrics.stations,
                        ),
                      },
                      (_, employee) => (
                        <button
                          key={employee}
                          type="button"
                          aria-pressed={selected === `employee-${employee + 1}`}
                          onClick={() => select(`employee-${employee + 1}`)}
                          className="min-h-11 rounded-full border border-pine px-3 text-xs text-pine aria-pressed:bg-mint"
                        >
                          Employee {employee + 1} · counter {employee + 1}
                        </button>
                      ),
                    )}
                  </div>
                )}
                {selected && (
                  <p
                    role="status"
                    aria-label="Person inspection"
                    className="mt-3 rounded-lg bg-paper p-3 text-xs text-muted"
                  >
                    {selected.startsWith("employee-")
                      ? `Employee ${selected.slice(9)}`
                      : selected}{" "}
                    ·{" "}
                    {selected.startsWith("employee-")
                      ? frame.employees.some(
                          (employee) => employee.id === selected,
                        )
                        ? `staffing counter ${selected.slice(9)} · stationary role marker`
                        : staffing &&
                            Number(selected.slice(9)) <=
                              Math.min(staffing.headcount, run.metrics.stations)
                          ? "off shift · shop closed"
                          : "not staffed in this scenario"
                      : customer
                        ? `${frame.customers.find((dot) => dot.id === selected)?.state ?? (customer.decision === "leave" ? "left" : "departed")} · ${customerLabel(customer, !story.compare)}`
                        : "not arrived yet"}
                  </p>
                )}
              </Card>
            );
          })}
        </div>
        {/* HAC-93: one selection shared by every view; the card reads the shop clock. */}
        <InspectPanel
          events={data[inspectIndex].run.events}
          minute={shopMinute}
          closeMin={closeMin}
          selectedId={selected}
          onSelect={select}
          source={context.phase === "ready" ? "stored" : "engine"}
          scenarioLabel={
            data.length > 1
              ? (story.scenarioLabels[inspectIndex] ??
                `Scenario ${inspectIndex + 1}`)
              : undefined
          }
          followUnavailableReason="the modeled café shows the whole floor, and this run has no street trips to follow in the city"
          controls={
            data.length > 1 && (
              <label className="grid gap-1 text-sm font-medium">
                Scenario
                <select
                  className="rounded-lg border border-line bg-surface p-2 text-ink"
                  value={inspectIndex}
                  onChange={(event) =>
                    setInspectIndex(Number(event.target.value))
                  }
                >
                  {data.map((_, index) => (
                    <option key={index} value={index}>
                      {story.scenarioLabels[index] ?? `Scenario ${index + 1}`}
                    </option>
                  ))}
                </select>
              </label>
            )
          }
        />
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
        {interiorMode === "scan" && matterport
          ? story.footnote.replace(
              "Modeled layout, not a Matterport scan.",
              "The backdrop is a public Matterport café reference, not the selected Houston property. Toy customer dots and proposed service counters are simulation overlays, not observed activity or captured furnishings.",
            )
          : story.footnote}
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
  speed: number;
  onSpeed: (speed: number) => void;
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
          onSpeed(speeds[(speeds.indexOf(speed) + 1) % speeds.length])
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
  value: number | string;
  warn?: boolean;
}) {
  return (
    <div className="flex flex-col">
      <dt className="order-2 text-xs text-muted">{label}</dt>
      <dd
        className={`order-1 text-2xl font-semibold tabular-nums ${warn ? "text-danger" : ""}`}
      >
        {value}
      </dd>
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
