import type { LayoutPoint } from "@/lib/contracts/layout";
import type { ScanPlacement } from "@/lib/contracts/interior";
import {
  PlacementSolveError,
  solvePlacement,
  type SolvedPlacement,
  type Vec3,
} from "@/lib/layout/scan-transform";

/**
 * HAC-138: development-only "pick anchor" tool. A developer clicks 2–3 floor
 * points in Showcase that correspond to known room points (feet); the tool
 * solves the scan placement to paste into the scan's registry row.
 */
export type PointerIntersection = {
  position: Vec3;
  normal: Vec3;
  floorId?: string | number;
};
export type PointerSdk = {
  Pointer: {
    intersection: {
      subscribe(callback: (hit: PointerIntersection) => void): {
        cancel(): void;
      };
    };
  };
};

/** Never in production builds; `NEXT_PUBLIC_*` flags are not consulted. */
export function pickAnchorEnabled(nodeEnv = process.env.NODE_ENV) {
  return nodeEnv !== "production";
}

/** Default anchors: the room origin and points 10 ft along plan x and plan y. */
export const DEFAULT_ROOM_ANCHORS: readonly LayoutPoint[] = [
  { x: 0, y: 0 },
  { x: 10, y: 0 },
  { x: 0, y: 10 },
];
/** A floor hit's normal must point mostly up (SDK +Y). */
const FLOOR_NORMAL_MIN_Y = 0.9;

export type AnchorPickerState = {
  picked: Vec3[];
  next: LayoutPoint | null;
  solved: SolvedPlacement | null;
  /** The registry placement to paste, with sweeps left for the author. */
  placement: ScanPlacement | null;
  error: string | null;
};

export function initialPickerState(
  roomAnchors: readonly LayoutPoint[] = DEFAULT_ROOM_ANCHORS,
): AnchorPickerState {
  return {
    picked: [],
    next: roomAnchors[0] ?? null,
    solved: null,
    placement: null,
    error: null,
  };
}

export function createAnchorPicker(
  sdk: PointerSdk,
  options: {
    roomAnchors?: readonly LayoutPoint[];
    scale?: number;
    onChange?: (state: AnchorPickerState) => void;
  } = {},
) {
  const anchors = (options.roomAnchors ?? DEFAULT_ROOM_ANCHORS).slice(0, 3);
  if (anchors.length < 2) throw new Error("Provide two or three room anchors");
  let latest: PointerIntersection | null = null;
  const picked: Vec3[] = [];
  let solved: SolvedPlacement | null = null;
  let error: string | null = null;
  const subscription = sdk.Pointer.intersection.subscribe((hit) => {
    latest = hit;
  });
  const toPlacement = (
    sweeps: Pick<ScanPlacement, "entranceSweep" | "serviceSweep">,
  ): ScanPlacement | null =>
    solved
      ? { ...solved.placement, scale: options.scale ?? 1, ...sweeps }
      : null;
  const state = (): AnchorPickerState => ({
    picked: [...picked],
    next: anchors[picked.length] ?? null,
    solved,
    placement: toPlacement({ entranceSweep: null, serviceSweep: null }),
    error,
  });
  const resolve = () => {
    solved = null;
    error = null;
    if (picked.length >= 2)
      try {
        solved = solvePlacement(
          picked.map((scan, index) => ({ room: anchors[index], scan })),
        );
      } catch (cause) {
        if (!(cause instanceof PlacementSolveError)) throw cause;
        error = cause.message;
      }
    options.onChange?.(state());
  };
  return {
    state,
    /** Records the pointer's current intersection for the next room anchor. */
    record() {
      if (picked.length >= anchors.length) return state();
      if (!latest) {
        error = "Move the pointer over the floor first";
      } else if (latest.normal.y < FLOOR_NORMAL_MIN_Y) {
        error = "That point is not on the floor";
      } else {
        picked.push({ ...latest.position });
        resolve();
        return state();
      }
      options.onChange?.(state());
      return state();
    },
    undo() {
      picked.pop();
      resolve();
      return state();
    },
    /** A complete registry placement, once solved. Sweeps are authored separately. */
    placement(
      sweeps: Pick<ScanPlacement, "entranceSweep" | "serviceSweep"> = {
        entranceSweep: null,
        serviceSweep: null,
      },
    ): ScanPlacement | null {
      return toPlacement(sweeps);
    },
    dispose() {
      subscription.cancel();
    },
  };
}
