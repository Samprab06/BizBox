/**
 * Cold-load progress for the 3D neighborhood (HAC-177).
 *
 * Every stage here comes from a real event: the SDK import, the tile decoder
 * workers, the Vexcel tileset document, Cesium's own request/processing
 * counters and its first rendered tile. The total tile count for a view is not
 * known up front (Cesium discovers it while traversing), so this never shows a
 * percentage: it reports counts and elapsed time instead.
 */

export const DECODER_COUNT = 2;
/** After this long without a rendered building, offer to skip the 3D view. */
export const SKIP_OFFER_MS = 8000;

export type CityLoadState = {
  phase: "loading" | "visible" | "settled" | "failed" | "skipped";
  /** Undefined until the scene starts loading (it waits to scroll into view). */
  startedAt?: number;
  engineReady: boolean;
  decodersReady: number;
  imageryReady: boolean;
  tilesReady: number;
  pending: number;
  processing: number;
  firstBuildingAt?: number;
  settledAt?: number;
};

export type CityLoadEvent =
  | { type: "start"; at: number }
  | { type: "engine-ready" }
  | { type: "decoder-ready" }
  | { type: "imagery-ready" }
  | { type: "progress"; pending: number; processing: number }
  | { type: "tile-ready" }
  | { type: "first-building"; at: number }
  | { type: "settled"; at: number }
  | { type: "failed" }
  | { type: "skip" };

export function initialCityLoad(at?: number): CityLoadState {
  return {
    phase: "loading",
    startedAt: at,
    engineReady: false,
    decodersReady: 0,
    imageryReady: false,
    tilesReady: 0,
    pending: 0,
    processing: 0,
  };
}

const active = (state: CityLoadState) =>
  state.phase === "loading" || state.phase === "visible";

export function reduceCityLoad(
  state: CityLoadState,
  event: CityLoadEvent,
): CityLoadState {
  if (event.type === "start") return initialCityLoad(event.at);
  if (event.type === "skip")
    return active(state) ? { ...state, phase: "skipped" } : state;
  if (!active(state)) return state;
  switch (event.type) {
    case "engine-ready":
      return state.engineReady ? state : { ...state, engineReady: true };
    case "decoder-ready":
      return state.decodersReady >= DECODER_COUNT
        ? state
        : { ...state, decodersReady: state.decodersReady + 1 };
    case "imagery-ready":
      return state.imageryReady ? state : { ...state, imageryReady: true };
    case "progress":
      return state.pending === event.pending &&
        state.processing === event.processing
        ? state
        : { ...state, pending: event.pending, processing: event.processing };
    case "tile-ready":
      return { ...state, tilesReady: state.tilesReady + 1 };
    case "first-building":
      return state.phase === "loading"
        ? { ...state, phase: "visible", firstBuildingAt: event.at }
        : state;
    case "settled":
      // Cesium can report an empty queue before anything renders (for
      // example a view with no tiles); only a rendered view is "settled".
      return state.phase === "visible"
        ? { ...state, phase: "settled", settledAt: event.at }
        : state;
    case "failed":
      // A failed tile after buildings are visible leaves the view usable.
      return state.phase === "loading" ? { ...state, phase: "failed" } : state;
  }
}

export type CityLoadView = {
  /** Data attribute value, also used by tests and profiling. */
  stage:
    | "engine"
    | "decoders"
    | "imagery"
    | "tiles"
    | "refining"
    | "settled"
    | "failed"
    | "skipped";
  title: string;
  detail?: string;
  step?: { index: number; total: number };
  elapsedSeconds: number;
  offerSkip: boolean;
};

const TOTAL_STEPS = 4;

function tileCounts(state: CityLoadState) {
  const parts = [
    `${state.tilesReady} ${state.tilesReady === 1 ? "tile" : "tiles"} ready`,
  ];
  if (state.pending > 0) parts.push(`${state.pending} downloading`);
  if (state.processing > 0) parts.push(`${state.processing} decoding`);
  return parts.join(" · ");
}

export function describeCityLoad(
  state: CityLoadState,
  now: number,
): CityLoadView {
  const startedAt = state.startedAt ?? now;
  const elapsedSeconds = Math.max(
    0,
    Math.floor(((state.firstBuildingAt ?? now) - startedAt) / 1000),
  );
  const base = { elapsedSeconds, offerSkip: false };
  switch (state.phase) {
    case "failed":
      return {
        ...base,
        stage: "failed",
        title:
          "3D neighborhood unavailable. Check WebGL support or retry imagery.",
      };
    case "skipped":
      return { ...base, stage: "skipped", title: "3D neighborhood skipped" };
    case "settled":
      return { ...base, stage: "settled", title: "3D neighborhood loaded" };
    case "visible":
      return {
        ...base,
        stage: "refining",
        title: "Refining building detail",
        detail: tileCounts(state),
      };
    case "loading":
      break;
  }
  const offerSkip = now - startedAt >= SKIP_OFFER_MS;
  if (!state.engineReady)
    return {
      ...base,
      offerSkip,
      stage: "engine",
      title: "Loading the 3D engine",
      step: { index: 1, total: TOTAL_STEPS },
    };
  if (state.decodersReady < DECODER_COUNT)
    return {
      ...base,
      offerSkip,
      stage: "decoders",
      title: "Preparing tile decoders",
      detail: `${state.decodersReady} of ${DECODER_COUNT} ready`,
      step: { index: 2, total: TOTAL_STEPS },
    };
  if (!state.imageryReady)
    return {
      ...base,
      offerSkip,
      stage: "imagery",
      title: "Connecting to Vexcel imagery",
      step: { index: 3, total: TOTAL_STEPS },
    };
  return {
    ...base,
    offerSkip,
    stage: "tiles",
    title: "Streaming buildings",
    detail: tileCounts(state),
    step: { index: 4, total: TOTAL_STEPS },
  };
}
