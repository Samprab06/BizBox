"use client";

import dynamic from "next/dynamic";
import { useMemo, useState } from "react";
import {
  FURNITURE_CATALOG,
  FURNITURE_ATTRIBUTION,
} from "@/lib/furniture/catalog";
import type {
  SpatialCommand,
  SpatialExperimentResult,
  SpatialRun,
} from "@/lib/contracts/spatial";
import type { InteriorFlowState } from "@/lib/client/flow-steps";
import { applySpatialCommand, runSpatialExperiment } from "@/lib/spatial";
import { spatialScanReplay } from "./spatial-scan-replay";
import styles from "@/components/workspace-screen/workspace-glass.module.css";

const ExperimentScene = dynamic(() => import("./experiment-scene"), {
  ssr: false,
  loading: () => <p>Loading furniture models…</p>,
});
const categoryLabels = {
  coffee: "Coffee shop",
  quick_food: "Quick-service food",
  salon_barber: "Salon / barber",
  fitness: "Fitness studio",
};
const number = (value: number | null) =>
  value === null
    ? "Unavailable"
    : value.toLocaleString("en-US", { maximumFractionDigits: 1 });
const button =
  "rounded-lg border border-glass-edge bg-field px-3 py-2 text-xs hover:bg-panel-raised focus-visible:outline focus-visible:outline-2";

export type ExperimentViewState = {
  minute: number;
  side: "baseline" | "variant";
  customerId: string;
};

export function InteriorExperimentPanel({
  interior,
  address,
  error,
  onCommand,
  onRun,
  onReview,
  onFinalize,
  onBack,
  viewState,
  onViewStateChange,
  preparing = false,
}: {
  interior: InteriorFlowState;
  address: string;
  error: string | null;
  onCommand: (command: SpatialCommand) => void;
  onRun: (mode?: "jev" | "assumed") => void;
  preparing?: boolean;
  onReview: () => void;
  onFinalize: () => void;
  onBack: () => void;
  viewState?: ExperimentViewState;
  onViewStateChange?: (state: ExperimentViewState) => void;
}) {
  const { draft } = interior;
  const [selected, setSelected] = useState("");
  const [localView, setLocalView] = useState<ExperimentViewState>({
    minute: draft.settings.openMin,
    side: "variant",
    customerId: "",
  });
  const currentView = viewState ?? localView;
  const setView = onViewStateChange ?? setLocalView;
  const { minute, side, customerId } = currentView;
  const setMinute = (value: number) =>
    setView({ ...currentView, minute: value });
  const setSide = (value: "baseline" | "variant") =>
    setView({ ...currentView, side: value });
  const setCustomerId = (value: string) =>
    setView({ ...currentView, customerId: value });
  const [scene, setScene] = useState(false);
  const resultState = useMemo(() => {
    if (interior.ranRevision !== draft.revision)
      return { result: null, error: null };
    try {
      return {
        result: runSpatialExperiment({
          baseline: interior.baseline,
          variant: draft,
          policies: interior.policies,
        }),
        error: null,
      };
    } catch (cause) {
      return {
        result: null,
        error:
          cause instanceof Error ? cause.message : "Experiment unavailable",
      };
    }
  }, [interior, draft]);
  const result = resultState.result;
  const run = result?.[side].runs[0];
  const item = draft.items.find((item) => item.id === selected);
  const selectedCatalog = FURNITURE_CATALOG.find(
    (c) => c.id === item?.catalogId,
  );

  const customer = run?.customers.find(
    (customer) => customer.id === customerId,
  );
  const decision = run?.decisions.find(
    (decision) => decision.customerId === customerId,
  );
  const displayDraft =
    side === "baseline" && result ? interior.baseline : draft;
  const projected = run
    ? spatialScanReplay(displayDraft, run, minute, customerId).projectedLayout!
        .people
    : [];
  const active = projected.filter((person) => person.role === "customer");
  function add(catalogId: string) {
    for (let z = 1; z < draft.room.depthM - 1; z += 0.5)
      for (let x = 1; x < draft.room.widthM - 1; x += 0.5) {
        const command: SpatialCommand = {
          type: "add",
          catalogId,
          id: `${catalogId}-${draft.revision + 1}`,
          x,
          z,
          rotation: 0,
        };
        try {
          applySpatialCommand(draft, command);
          onCommand(command);
          setSelected(command.id);
          return;
        } catch {
          /* Try the next valid draft location. */
        }
      }
    // The shared validator supplies the visible error when no candidate fits.
    onCommand({
      type: "add",
      catalogId,
      id: `${catalogId}-${draft.revision + 1}`,
      x: 0,
      z: 0,
      rotation: 0,
    });
  }
  return (
    <section
      className={`${styles.glass} pointer-events-auto relative z-20 m-3 max-h-[calc(100dvh-170px)] overflow-auto rounded-2xl p-5`}
      aria-label="Interior experiments"
      data-agent-anchor="interior_floorplan"
      data-interior-experiment
    >
      <header className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <p className="text-xs text-muted">
            INTERIOR EXPERIMENTS · {categoryLabels[draft.category]}
          </p>
          <h2 className="mt-1 text-xl font-semibold">{address}</h2>
          <p className="mt-1 text-xs text-muted">
            {draft.city === "houston" ? "Houston" : "Los Angeles"} ·{" "}
            {draft.timezone} · revision {draft.revision}
          </p>
        </div>
        <button className={button} onClick={onBack}>
          Back to exterior results
        </button>
      </header>
      <p className="my-3 text-sm text-muted">
        {draft.room.source === "matterport-bounds"
          ? "Approximate selected-suite room envelope"
          : "Modeled proposal · assumed room dimensions"}{" "}
        ({number(draft.room.widthM)} × {number(draft.room.depthM)} m). Real
        furniture models from Poly Haven.
        {draft.room.source === "matterport-bounds"
          ? " Room bounds are approximate; entrance/service points are assumptions, and walls, openings and existing furniture are incomplete."
          : " This is not measured building geometry or a Matterport scan."}{" "}
        Changes are saved in this browser.
      </p>
      <p className="mb-4 text-xs">
        Ask your consultant to add, move, rotate or remove furniture, change
        operating assumptions, and compare the results. You can also use these
        controls.
      </p>
      {(error || resultState.error) && (
        <p
          role="alert"
          className="mb-3 rounded-lg border border-red-300/40 p-3"
        >
          {error || resultState.error}
        </p>
      )}
      <div className="grid gap-5 xl:grid-cols-[minmax(0,1.5fr)_minmax(230px,1fr)]">
        <div className="min-w-0">
          <div className="mb-2 flex flex-wrap gap-2">
            <button
              className={button}
              aria-pressed={!scene}
              onClick={() => setScene(false)}
            >
              Floor plan
            </button>
            <button
              className={button}
              aria-pressed={scene}
              onClick={() => setScene(true)}
            >
              3D furniture
            </button>
            {result && (
              <>
                <button
                  className={button}
                  aria-pressed={side === "baseline"}
                  onClick={() => setSide("baseline")}
                >
                  Baseline
                </button>
                <button
                  className={button}
                  aria-pressed={side === "variant"}
                  onClick={() => setSide("variant")}
                >
                  Proposal
                </button>
              </>
            )}
          </div>
          {scene ? (
            <ExperimentScene
              draft={displayDraft}
              people={projected}
              onCustomerSelect={setCustomerId}
              selected={selected}
              onSelect={setSelected}
            />
          ) : (
            <svg
              viewBox={`-1 -1 ${displayDraft.room.widthM + 2} ${displayDraft.room.depthM + 2}`}
              role="img"
              aria-label="Proposed interior floor plan"
              className="max-h-[340px] w-full rounded-xl bg-[#1c2525]"
            >
              <rect
                width={displayDraft.room.widthM}
                height={displayDraft.room.depthM}
                fill="#45574f"
                stroke="#a3b5aa"
                strokeWidth=".05"
              />
              {run?.customers[0] && (
                <polyline
                  points={run.customers[0].route
                    .map((point) => `${point.x},${point.z}`)
                    .join(" ")}
                  fill="none"
                  stroke="#c7e6d7"
                  strokeWidth=".05"
                  strokeDasharray=".15 .12"
                />
              )}
              <circle
                cx={displayDraft.entrance.x}
                cy={displayDraft.entrance.z}
                r=".22"
                fill="#bfdbfe"
              />
              <text
                x={displayDraft.entrance.x + 0.3}
                y={displayDraft.entrance.z + 0.3}
                fontSize=".25"
                fill="white"
              >
                Entrance
              </text>
              <rect
                x={displayDraft.servicePoint.x - 0.5}
                y={displayDraft.servicePoint.z - 0.3}
                width="1"
                height=".6"
                fill="#a7f3d0"
              />
              <text
                x={displayDraft.servicePoint.x + 0.6}
                y={displayDraft.servicePoint.z}
                fontSize=".25"
                fill="white"
              >
                Service
              </text>
              {displayDraft.items.map((placed) => {
                const catalog = FURNITURE_CATALOG.find(
                  (c) => c.id === placed.catalogId,
                )!;
                return (
                  <g
                    key={placed.id}
                    transform={`translate(${placed.x} ${placed.z}) rotate(${placed.rotation})`}
                  >
                    <rect
                      x={-catalog.widthM / 2}
                      y={-catalog.depthM / 2}
                      width={catalog.widthM}
                      height={catalog.depthM}
                      fill={selected === placed.id ? "#a7f3d0" : "#c6ad8c"}
                      stroke="#e9ded0"
                      strokeWidth=".04"
                    />
                    <text
                      textAnchor="middle"
                      y=".08"
                      fontSize=".2"
                      fill="#17241d"
                    >
                      {catalog.role}
                    </text>
                  </g>
                );
              })}
              {active.map((person) => (
                <circle
                  key={person.id}
                  data-spatial-person={person.id}
                  cx={person.x}
                  cy={person.z}
                  r={person.id === customerId ? 0.17 : 0.1}
                  fill="#93c5fd"
                />
              ))}
            </svg>
          )}
          <p className="mt-2 text-xs text-muted">
            Furniture footprints use source-model bounds. The service marker is
            a modeled resource. Route playback uses saved walking paths; waiting
            positions are schematic.
          </p>
          {run && (
            <div className="mt-4">
              <label className="text-sm" htmlFor="spatial-clock">
                Replay · {clock(minute)} ({side}, seed {run.seed})
              </label>
              <input
                id="spatial-clock"
                aria-label="Interior replay time"
                type="range"
                min={draft.settings.openMin}
                max={draft.settings.closeMin}
                step=".1"
                value={minute}
                onChange={(event) => setMinute(Number(event.target.value))}
                className="mt-2 w-full"
              />
              <p className="text-xs text-muted">
                Scrub saved events; no model calls during playback.
              </p>
            </div>
          )}
        </div>
        <div>
          <h3 className="mb-2 font-medium">Furniture catalog</h3>
          <ul className="space-y-2">
            {FURNITURE_CATALOG.map((catalog) => (
              <li
                key={catalog.id}
                className="flex items-center justify-between gap-2 rounded-lg border border-glass-edge p-2"
              >
                <div>
                  <p className="text-sm">{catalog.name}</p>
                  <p className="text-xs text-muted">
                    {number(catalog.widthM)} × {number(catalog.depthM)} m ·{" "}
                    {catalog.seats ? `${catalog.seats} seat` : catalog.role} ·
                    price unknown
                  </p>
                </div>
                <button
                  className={button}
                  aria-label={`Add ${catalog.name}`}
                  onClick={() => add(catalog.id)}
                >
                  Add
                </button>
              </li>
            ))}
          </ul>
          <p className="mt-2 text-xs text-muted">
            {typeof FURNITURE_ATTRIBUTION === "string"
              ? FURNITURE_ATTRIBUTION
              : "Poly Haven · CC0"}
            . Furniture is shared across categories; specialist equipment
            specifications are not supplied.
          </p>
          <label className="mt-4 block text-sm">
            Selected item
            <select
              aria-label="Selected furniture"
              className="mt-1 block w-full rounded-lg border border-glass-edge bg-field p-2"
              value={selected}
              onChange={(event) => setSelected(event.target.value)}
            >
              <option value="">Choose an item</option>
              {draft.items.map((placed) => (
                <option key={placed.id} value={placed.id}>
                  {
                    FURNITURE_CATALOG.find((c) => c.id === placed.catalogId)
                      ?.name
                  }{" "}
                  · {placed.id}
                </option>
              ))}
            </select>
          </label>
          {item && (
            <div className="mt-2 space-y-2">
              <p className="text-xs text-muted">{selectedCatalog?.name}</p>
              <div className="flex gap-2">
                {(["x", "z"] as const).map((axis) => (
                  <label key={axis} className="text-xs">
                    {axis.toUpperCase()} (m)
                    <input
                      aria-label={`Furniture ${axis.toUpperCase()} meters`}
                      className="mt-1 w-24 rounded border border-glass-edge bg-field p-2"
                      type="number"
                      step=".25"
                      value={item[axis]}
                      onChange={(event) => {
                        const value = Number(event.target.value);
                        if (Number.isFinite(value))
                          onCommand({
                            type: "move",
                            id: item.id,
                            x: axis === "x" ? value : item.x,
                            z: axis === "z" ? value : item.z,
                          });
                      }}
                    />
                  </label>
                ))}
              </div>
              <div className="flex gap-2">
                <button
                  className={button}
                  onClick={() =>
                    onCommand({
                      type: "rotate",
                      id: item.id,
                      rotation: ((item.rotation + 90) % 360) as
                        0 | 90 | 180 | 270,
                    })
                  }
                >
                  Rotate 90°
                </button>
                <button
                  className={button}
                  onClick={() => onCommand({ type: "remove", id: item.id })}
                >
                  Remove item
                </button>
              </div>
            </div>
          )}
          <button
            className={`${button} mt-3`}
            onClick={() => onCommand({ type: "clear" })}
            disabled={!draft.items.length}
          >
            Clear furniture
          </button>
        </div>
      </div>
      <details className="mt-5 rounded-lg border border-glass-edge p-3">
        <summary className="cursor-pointer text-sm">
          Entrance and service anchors
        </summary>
        <p className="mt-2 text-xs text-muted">
          Set the assumed entrance and service point in this room&apos;s meter
          coordinates. Blocked routes and out-of-room points are rejected.
        </p>
        <div className="mt-3 grid grid-cols-2 gap-3 sm:grid-cols-4">
          {(["entrance", "servicePoint"] as const).flatMap((anchor) =>
            (["x", "z"] as const).map((axis) => (
              <label className="text-xs" key={`${anchor}-${axis}`}>
                {anchor === "entrance" ? "Entrance" : "Service"}{" "}
                {axis.toUpperCase()} (m)
                <input
                  type="number"
                  aria-label={`${anchor === "entrance" ? "Entrance" : "Service"} ${axis.toUpperCase()} meters`}
                  className="mt-1 block w-full rounded border border-glass-edge bg-field p-2"
                  value={draft[anchor][axis]}
                  step=".25"
                  onChange={(event) =>
                    onCommand({
                      type: "layout",
                      entrance: {
                        ...draft.entrance,
                        ...(anchor === "entrance"
                          ? { [axis]: Number(event.target.value) }
                          : {}),
                      },
                      servicePoint: {
                        ...draft.servicePoint,
                        ...(anchor === "servicePoint"
                          ? { [axis]: Number(event.target.value) }
                          : {}),
                      },
                    })
                  }
                />
              </label>
            )),
          )}
        </div>
      </details>
      <details className="mt-5 rounded-lg border border-glass-edge p-3">
        <summary className="cursor-pointer text-sm">
          Operating assumptions
        </summary>
        <div className="mt-3 grid grid-cols-2 gap-3 sm:grid-cols-4">
          {(
            [
              { key: "arrivals", label: "Arrivals / day", step: 1 },
              { key: "staff", label: "Staff", step: 1 },
              {
                key: "serviceMin",
                label:
                  draft.category === "fitness"
                    ? "Session minutes"
                    : draft.category === "salon_barber"
                      ? "Appointment minutes"
                      : "Service minutes",
                step: 1,
              },
              {
                key: "averageTicketUsd",
                label: "Average ticket ($)",
                step: 0.5,
              },
              { key: "wageUsdPerHour", label: "Wage / hour ($)", step: 0.5 },
              { key: "openMin", label: "Opening minute", step: 30 },
              { key: "closeMin", label: "Closing minute", step: 30 },
              {
                key: "resourceCapacity",
                label:
                  draft.category === "fitness"
                    ? "Session capacity"
                    : draft.category === "salon_barber"
                      ? "Service chairs"
                      : "Service positions",
                step: 1,
              },
              {
                key: "appointmentFraction",
                label: "Appointment share (0–1)",
                step: 0.1,
              },
              {
                key: "sessionIntervalMin",
                label: "Session interval (min)",
                step: 5,
              },
              { key: "pickupMin", label: "Pickup minutes", step: 0.5 },
            ] as const
          ).map((field) => (
            <label key={field.key} className="text-xs">
              {field.label}
              <input
                type="number"
                aria-label={field.label}
                step={field.step}
                value={draft.settings[field.key]}
                className="mt-1 block w-full rounded border border-glass-edge bg-field p-2"
                onChange={(event) =>
                  onCommand({
                    type: "settings",
                    settings: {
                      ...draft.settings,
                      [field.key]: Number(event.target.value),
                    },
                  })
                }
              />
            </label>
          ))}
        </div>
        <p className="mt-2 text-xs text-muted">
          These are editable scenario assumptions. Catalog purchase prices are
          unknown and excluded from the operating comparison.
        </p>
      </details>
      <div className="my-4 flex flex-wrap items-center gap-3">
        <button
          className={styles.primary}
          disabled={preparing || draft.category !== "coffee"}
          onClick={() => onRun("jev")}
        >
          {preparing ? "Preparing Jev decisions…" : "Run with Jev"}
        </button>
        <button
          className={styles.secondary}
          disabled={preparing}
          onClick={() => onRun("assumed")}
        >
          Run assumed preview
        </button>
        <p className="text-xs text-muted">
          Jev preparation currently supports café experiments. It prepares
          decisions for this exact layout. Assumed preview uses explicit local
          assumptions; it does not contact Jev. Furniture controls use catalog
          and coordinate edits; direct dragging inside Matterport is
          unavailable.
        </p>
        <span className="text-xs text-muted">
          {result
            ? `${result.seeds.length} paired seeds · ${result.source === "assumed" ? "Assumed behavior; Jev not used" : result.source === "jev" ? "Jev-backed decisions for this layout" : result.source}`
            : "Run the current proposal to compare with the saved baseline."}
        </span>
      </div>
      {result && (
        <>
          <ExperimentResults result={result} />
          <div className="mt-4 grid gap-4 md:grid-cols-2">
            <div>
              <label className="text-sm">
                Inspect a simulated customer
                <select
                  aria-label="Inspect simulated customer"
                  value={customerId}
                  onChange={(event) => setCustomerId(event.target.value)}
                  className="mt-1 block w-full rounded border border-glass-edge bg-field p-2"
                >
                  <option value="">Choose a customer</option>
                  {run?.customers.map((person) => (
                    <option key={person.id} value={person.id}>
                      {person.id} · {person.personaId}
                    </option>
                  ))}
                </select>
              </label>
              {customer && (
                <p className="mt-2 text-xs">
                  Arrived {clock(customer.arrivalMin)} · walked{" "}
                  {number(run?.routeLengthM ?? 0)} m · queue arrival{" "}
                  {clock(customer.queueArrivalMin)}
                </p>
              )}
              {decision && (
                <p className="mt-2 text-xs" data-customer-decision>
                  {decision.personaId}: {decision.action} at queue length{" "}
                  {decision.queueLength}. Join probability{" "}
                  {number(decision.probability * 100)}%; saved draw{" "}
                  {number(decision.draw)}. Source: {decision.source}
                  {decision.modelVersion
                    ? ` (${decision.modelVersion})`
                    : "; authored assumption, not a Jev response"}
                  {decision.evidenceId
                    ? ` · Evidence ${decision.evidenceId}`
                    : ""}
                  .
                </p>
              )}
            </div>
            <div className="text-xs text-muted">
              <ul className="list-disc space-y-1 pl-4">
                {result.limitations.map((note, index) => (
                  <li key={index}>{note}</li>
                ))}
              </ul>
            </div>
          </div>
          <div className="mt-5 flex flex-wrap items-center gap-3">
            <button className={button} onClick={onReview}>
              Review this interior result
            </button>
            <button
              className={styles.primary}
              disabled={interior.reviewedRevision !== draft.revision}
              onClick={onFinalize}
            >
              Continue to final report
            </button>
            {interior.reviewedRevision === draft.revision && (
              <p className="text-xs">
                Current revision reviewed. Any edit requires another run and
                review.
              </p>
            )}
          </div>
        </>
      )}
    </section>
  );
}

export function ExperimentResults({
  result,
}: {
  result: SpatialExperimentResult;
}) {
  return (
    <section aria-label="Interior experiment results">
      <h3 className="font-medium">Baseline → proposal</h3>
      <div className="mt-2 overflow-x-auto">
        <table className="w-full text-left text-xs">
          <thead>
            <tr>
              <th className="p-2">Metric / operating day</th>
              <th className="p-2">Baseline mean</th>
              <th className="p-2">Proposal mean</th>
              <th className="p-2">Paired change · p5–p95</th>
            </tr>
          </thead>
          <tbody>
            {(
              [
                { key: "served", label: "Customers served" },
                { key: "abandoned", label: "Customers left" },
                { key: "meanWaitMin", label: "Mean wait (min)" },
                { key: "routeLengthM", label: "Walking route (m)" },
                { key: "revenueUsd", label: "Revenue ($)" },
                {
                  key: "dailyContributionUsd",
                  label: "Operating contribution ($)",
                },
              ] as const
            ).map((metric) => (
              <tr key={metric.key} className="border-t border-glass-edge">
                <th className="p-2 font-normal">{metric.label}</th>
                <td className="p-2">
                  {number(result.baseline.metrics[metric.key].mean)}
                </td>
                <td className="p-2">
                  {number(result.variant.metrics[metric.key].mean)}
                </td>
                <td className="p-2">
                  {number(result.delta[metric.key].mean)} (
                  {number(result.delta[metric.key].p5)} to{" "}
                  {number(result.delta[metric.key].p95)})
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <p className="mt-2 text-xs text-muted">
        Modeled outcomes, not a forecast. Empirical seed ranges, not confidence
        intervals. Furniture purchase costs are excluded.
      </p>
      <ul className="mt-2 list-disc pl-4 text-sm">
        {result.findings.map((finding, index) => (
          <li key={index}>{finding}</li>
        ))}
      </ul>
      <Closing run={result.variant.runs[0]} />
    </section>
  );
}
function Closing({ run }: { run: SpatialRun | undefined }) {
  return run ? (
    <p className="mt-2 text-xs text-muted">
      Representative proposal at closing: {run.metrics.waitingAtClose} waiting ·{" "}
      {run.metrics.inServiceAtClose} in service · {run.walkingAtClose} walking.
      Unfinished customers are not counted as served.
    </p>
  ) : null;
}
function clock(minute: number) {
  const m = Math.round(minute);
  return `${String(Math.floor(m / 60) % 24).padStart(2, "0")}:${String(m % 60).padStart(2, "0")}`;
}
