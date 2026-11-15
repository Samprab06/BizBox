"use client";
import dynamic from "next/dynamic";
import {
  nativeWorkStatus,
  type NativeProposalStatus,
} from "./native-work-status";
import {
  useEffect,
  useMemo,
  useRef,
  useState,
  type ComponentProps,
} from "react";
import type { InteriorResponse } from "@/lib/contracts/interior";
import type { SpatialScanContext } from "@/lib/contracts/spatial";
import type { InteriorAffordabilityAssessment } from "@/lib/contracts/interior-affordability";
import type { InteriorCalibration } from "@/lib/interior/proposal-state";
import type { DayResult } from "@/lib/sim/contracts";
import { runSpatialExperiment } from "@/lib/spatial";
import {
  selectedScanCalibration,
  type AuthoredCalibrationScope,
} from "./selected-scan-calibration";
import type { InteriorExperimentPanel } from "./experiment-panel";
import type { ServiceViewpoint } from "./matterport-bridge";
import {
  loadSelectedInterior,
  type InteriorRequestScope,
} from "./selected-interior-loader";
import styles from "@/components/workspace-screen/workspace-glass.module.css";
const MatterportView = dynamic(() => import("./matterport-view"), {
  ssr: false,
});
type Props = Omit<
  ComponentProps<typeof InteriorExperimentPanel>,
  "viewState" | "onViewStateChange"
> & {
  sdkKey?: string;
  onResolved: (response: InteriorResponse, scope: InteriorRequestScope) => void;
  onScanContext?: (
    context: SpatialScanContext,
    scope: InteriorRequestScope,
  ) => void;
  awaitingPlacement?: boolean;
  onProposalStatus?: (
    state: { revision: number; status: "loading" | "ready" | "failed" },
    scope: InteriorRequestScope,
    modelId: string,
  ) => void;
  onUndo?: () => void;
  canUndo?: boolean;
  authoredCalibration?: InteriorCalibration;
  authoredCalibrationScope?: AuthoredCalibrationScope;
  authoredScenarioNote?: string;
  authoredViewpoint?: ServiceViewpoint;
  affordability?: InteriorAffordabilityAssessment | null;
  affordabilityPreparing?: boolean;
  affordabilityError?: string | null;
  onCheckAffordability?: () => void;
};
type Loaded = { key: string; response?: InteriorResponse; error?: string };
const number = (value: number) =>
  value.toLocaleString("en-US", { maximumFractionDigits: 1 });
export function SelectedSiteInteriorStage(props: Props) {
  const {
      interior,
      address,
      sdkKey,
      onResolved,
      onScanContext,
      awaitingPlacement,
      onUndo,
      canUndo,
    } = props,
    { draft } = interior;
  const key = `${draft.projectId}:${interior.siteId}:${interior.comparisonId}:${draft.id}`;
  const scope = useMemo<InteriorRequestScope>(
    () => ({
      projectId: draft.projectId,
      siteId: interior.siteId,
      comparisonId: interior.comparisonId,
      draftId: draft.id,
      revision: draft.revision,
    }),
    [
      draft.projectId,
      interior.siteId,
      interior.comparisonId,
      draft.id,
      draft.revision,
    ],
  );
  const [loaded, setLoaded] = useState<Loaded>({ key: "" }),
    [attempt, retry] = useState(0);
  const cache = useRef<{ key: string; response: InteriorResponse } | null>(
      null,
    ),
    resolved = useRef(onResolved);
  useEffect(() => {
    resolved.current = onResolved;
  }, [onResolved]);
  useEffect(() => {
    const controller = new AbortController();
    let active = true;
    const timer = setTimeout(() => controller.abort(), 15000);
    const saved = cache.current?.key === key ? cache.current.response : null;
    void (
      saved
        ? Promise.resolve(saved)
        : loadSelectedInterior(interior.siteId, controller.signal)
    )
      .then((response) => {
        if (!active || controller.signal.aborted) return;
        cache.current = { key, response };
        setLoaded({ key, response });
        resolved.current(response, scope);
      })
      .catch(() => {
        if (active)
          setLoaded({ key, error: "This interior could not be opened." });
      })
      .finally(() => clearTimeout(timer));
    return () => {
      active = false;
      clearTimeout(timer);
      controller.abort();
    };
  }, [key, interior.siteId, scope, attempt]);
  const source =
    loaded.key === key && loaded.response ? loaded.response : interior.source;
  const result = useMemo(() => {
    if (interior.ranRevision !== draft.revision) return null;
    try {
      return runSpatialExperiment({
        baseline: interior.baseline,
        variant: draft,
        policies: interior.policies,
      });
    } catch {
      return null;
    }
  }, [interior, draft]);
  const run = result?.variant.runs[0];
  const [nativeState, setNativeState] = useState<NativeProposalStatus | null>(
    null,
  );
  const workingStatus = nativeWorkStatus({
    awaitingPlacement,
    preparing: props.preparing,
    revision: draft.revision,
    native: nativeState,
  });
  const [minute, setMinute] = useState(
      Math.min(draft.settings.closeMin, draft.settings.openMin + 24),
    ),
    [paused, setPaused] = useState(false),
    [customerId, selectCustomer] = useState("");
  const currentMinute = Math.max(
    draft.settings.openMin,
    Math.min(draft.settings.closeMin, minute),
  );
  useEffect(() => {
    if (!run || paused) return;
    let last = performance.now(),
      frame = 0;
    const tick = (now: number) => {
      const delta = Math.min(0.1, (now - last) / 1000);
      last = now;
      setMinute((value) => Math.min(draft.settings.closeMin, value + delta));
      frame = requestAnimationFrame(tick);
    };
    frame = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(frame);
  }, [run, paused, draft.settings.closeMin]);
  const calibration = useMemo(
    () =>
      source
        ? selectedScanCalibration(
            source,
            draft,
            props.authoredCalibration,
            props.authoredCalibrationScope,
          )
        : null,
    [source, draft, props.authoredCalibration, props.authoredCalibrationScope],
  );
  const empty = useMemo<DayResult>(
    () => ({
      siteId: draft.siteId,
      seed: 0,
      events: [],
      metrics: {
        dayType: "weekday",
        openMin: draft.settings.openMin,
        closeMin: draft.settings.closeMin,
        stations: 0,
        arrivals: 0,
        arrivalsOutsideHours: 0,
        joined: 0,
        served: 0,
        balked: 0,
        reneged: 0,
        abandoned: 0,
        inServiceAtClose: 0,
        waitingAtClose: 0,
        meanWaitMin: null,
        p90WaitMin: null,
        stationUtilization: 0,
        revenueUsd: 0,
      },
    }),
    [draft.siteId, draft.settings.openMin, draft.settings.closeMin],
  );
  const reviewed =
    interior.reviewedRevision === draft.revision &&
    interior.ranRevision === draft.revision;
  return (
    <section
      aria-label="Selected building interior"
      className="pointer-events-auto relative z-20 m-3 max-h-[calc(100dvh-150px)] overflow-auto rounded-2xl border border-glass-edge bg-panel p-3"
    >
      <header className="flex items-center justify-between gap-3 px-1">
        <div className="flex flex-wrap items-center gap-2">
          <h2 className="text-base font-medium">{address}</h2>
          {source?.provenance.scope === "property" && (
            <span className="rounded border border-glass-edge px-2 py-1 text-[10px] text-muted">
              Building reference
            </span>
          )}
        </div>
        <button className="text-xs text-muted underline" onClick={props.onBack}>
          Back to results
        </button>
      </header>
      {source?.kind === "scan" ? (
        (source.showcaseParams?.sdkKey ?? sdkKey) ? (
          <MatterportView
            key={`${key}:${source.modelId}`}
            mode="selected"
            config={{
              sdkKey: source.showcaseParams?.sdkKey ?? sdkKey!,
              modelId: source.modelId,
              ...(calibration
                ? {
                    placement: {
                      origin: {
                        x:
                          calibration.origin.x -
                          calibration.roomAnchor.x *
                            Math.cos(calibration.rotationY) -
                          calibration.roomAnchor.z *
                            Math.sin(calibration.rotationY),
                        y: calibration.origin.y,
                        z:
                          calibration.origin.z +
                          calibration.roomAnchor.x *
                            Math.sin(calibration.rotationY) -
                          calibration.roomAnchor.z *
                            Math.cos(calibration.rotationY),
                      },
                      rotationY: calibration.rotationY,
                      scale: 1,
                    },
                  }
                : {}),
              ...(calibration?.source === "authored-preset" &&
              props.authoredViewpoint
                ? { viewpoint: props.authoredViewpoint }
                : {}),
            }}
            run={
              run
                ? {
                    siteId: draft.siteId,
                    seed: run.seed,
                    events: run.events,
                    metrics: run.metrics,
                  }
                : empty
            }
            minute={currentMinute}
            employeeCount={draft.settings.staff}
            selected={customerId}
            select={selectCustomer}
            seek={setMinute}
            furnitureProposal={calibration ? draft : undefined}
            proposalCalibration={calibration ?? undefined}
            spatialReplay={
              run && calibration ? { draft, run, calibration } : undefined
            }
            onScanContext={(context) => onScanContext?.(context, scope)}
            onProposalStatus={(state) => {
              setNativeState((previous) =>
                previous?.revision === state.revision &&
                previous.status === state.status
                  ? previous
                  : state,
              );
              props.onProposalStatus?.(state, scope, source.modelId);
            }}
          />
        ) : (
          <iframe
            title={`Selected scan for ${address}`}
            src={`https://my.matterport.com/show?m=${encodeURIComponent(source.modelId)}&play=1&qs=1`}
            allow="fullscreen; xr-spatial-tracking"
            allowFullScreen
            className="mt-3 h-[560px] w-full border-0"
          />
        )
      ) : (
        <div className="p-8 text-sm" role="status">
          {loaded.key !== key && !interior.source
            ? "Opening interior…"
            : "No viewable interior is available for this location."}
          {loaded.key === key && loaded.error && (
            <button
              className="ml-3 underline"
              onClick={() => {
                cache.current = null;
                retry((value) => value + 1);
              }}
            >
              Retry
            </button>
          )}
        </div>
      )}
      {workingStatus && (
        <p role="status" className="my-3 text-sm">
          {workingStatus}
        </p>
      )}
      {props.error && (
        <p role="alert" className="my-3 text-sm">
          {props.error}
        </p>
      )}
      {result && interior.finding && (
        <section
          aria-label="Experiment finding"
          className="mt-3 rounded-lg border border-glass-edge p-3"
        >
          <h3 className="text-sm font-medium">
            Adding {interior.finding.change.name}
          </h3>
          <table className="mt-2 w-full text-left text-sm">
            <thead>
              <tr>
                <th className="font-normal text-muted"></th>
                <th className="font-normal text-muted">Before</th>
                <th className="font-normal text-muted">After</th>
              </tr>
            </thead>
            <tbody>
              {[
                {
                  label: "Walking (seconds)",
                  before: interior.finding.before.walkingDelayMin.mean,
                  after: interior.finding.after.walkingDelayMin.mean,
                  factor: 60,
                },
                {
                  label: "Served",
                  before: interior.finding.before.served.mean,
                  after: interior.finding.after.served.mean,
                  factor: 1,
                },
                {
                  label: "Operating contribution / day",
                  before: interior.finding.before.dailyContributionUsd.mean,
                  after: interior.finding.after.dailyContributionUsd.mean,
                  factor: 1,
                  money: true,
                },
              ].map((row) => (
                <tr key={row.label}>
                  <th className="py-1 font-normal">{row.label}</th>
                  {[row.before, row.after].map((value, index) => (
                    <td key={index}>
                      {value === null
                        ? "—"
                        : row.money
                          ? value.toLocaleString("en-US", {
                              style: "currency",
                              currency: "USD",
                              maximumFractionDigits: 0,
                            })
                          : number(value * row.factor)}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
          <p className="mt-1 text-xs text-muted">
            {interior.finding.source === "jev"
              ? "Jev estimate"
              : "Scenario estimate"}
          </p>
        </section>
      )}
      {result && !interior.finding && (
        <p className="mt-3 text-sm">
          Served: {number(result.baseline.metrics.served.mean)} →{" "}
          {number(result.variant.metrics.served.mean)}.{" "}
          <span className="text-xs text-muted">
            {result.source === "jev" ? "Jev estimate" : "Scenario estimate"}
          </span>
        </p>
      )}
      <div className="mt-3 flex flex-wrap items-center gap-2">
        {source?.kind === "scan" && !result && (
          <button
            className={styles.secondary}
            disabled={
              props.preparing ||
              !calibration ||
              (draft.items.length > 0 &&
                (nativeState?.revision !== draft.revision ||
                  nativeState.status !== "ready"))
            }
            onClick={() => props.onRun("jev")}
          >
            {props.preparing ? "Running…" : "Run experiment"}
          </button>
        )}
        {result && (
          <button
            className={styles.secondary}
            onClick={() => setPaused((value) => !value)}
          >
            {paused ? "Play simulation" : "Pause simulation"}
          </button>
        )}
        {result && !reviewed && (
          <button className={styles.primary} onClick={props.onReview}>
            Keep result
          </button>
        )}
        {reviewed && (
          <button className={styles.primary} onClick={props.onFinalize}>
            Continue to report
          </button>
        )}
        {canUndo && onUndo && (
          <button className={styles.secondary} onClick={onUndo}>
            Undo
          </button>
        )}
      </div>
    </section>
  );
}
