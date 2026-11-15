import type { SpatialScanContext } from "@/lib/contracts/spatial";
type Point = { x: number; y: number; z: number };
type Subscription = { cancel(): void };
export type NativePose = {
  position: Point;
  rotation: { x: number; y: number };
  sweep: string;
};
export type NativeSweep = {
  id?: string;
  sid?: string;
  enabled?: boolean;
  puckPosition?: Point;
  floorInfo?: { id?: string };
};
export type NativeHit = { position: Point; normal: Point; object?: string };
export type NativeFloorSdk = {
  Camera: {
    pose: { subscribe(callback: (pose: NativePose) => void): Subscription };
  };
  Pointer?: {
    intersection: {
      subscribe(callback: (hit: NativeHit) => void): Subscription;
    };
  };
  Sweep?: {
    current?: {
      subscribe(callback: (sweep: NativeSweep) => void): Subscription;
    };
    data?: {
      subscribe(observer: {
        onCollectionUpdated(rows: Record<string, NativeSweep>): void;
      }): Subscription;
    };
  };
};
const finite = (point: Point | undefined): point is Point =>
  Boolean(point && [point.x, point.y, point.z].every(Number.isFinite));
/** Observes actual SDK floor evidence only. It never invents room boundaries or a scale. */
export function watchNativeFloorContext(
  sdk: NativeFloorSdk,
  modelId: string,
  onChange: (context: SpatialScanContext) => void,
  options: { throttleMs?: number } = {},
) {
  let pose: NativePose | undefined,
    current: NativeSweep | undefined,
    pointer: NativeHit | undefined,
    sweeps: NativeSweep[] = [],
    lastSignature = "",
    disposed = false;
  let timer: ReturnType<typeof setTimeout> | undefined;
  let pending: SpatialScanContext | undefined;
  const emit = () => {
    if (disposed) return;
    const matching = Boolean(
      pose?.sweep &&
      pose.sweep === (current?.id ?? current?.sid) &&
      current?.floorInfo?.id &&
      finite(current.puckPosition),
    );
    let point: Point | undefined, source: "pointer" | "sweep" | undefined;
    if (matching && pose && current) {
      const floor = current.puckPosition!;
      if (
        pointer &&
        finite(pointer.position) &&
        finite(pointer.normal) &&
        pointer.normal.y >= 0.9 &&
        (!pointer.object || pointer.object === "intersectedobject.model") &&
        Math.abs(pointer.position.y - floor.y) <= 0.25 &&
        Math.hypot(
          pointer.position.x - pose.position.x,
          pointer.position.z - pose.position.z,
        ) <= 15
      ) {
        point = pointer.position;
        source = "pointer";
      } else {
        const yaw = (pose.rotation.y * Math.PI) / 180,
          forward = { x: -Math.sin(yaw), z: -Math.cos(yaw) };
        const candidates = sweeps
          .filter(
            (sweep) =>
              sweep.enabled !== false &&
              sweep.floorInfo?.id === current?.floorInfo?.id &&
              finite(sweep.puckPosition),
          )
          .map((sweep) => {
            const p = sweep.puckPosition!,
              dx = p.x - pose!.position.x,
              dz = p.z - pose!.position.z,
              distance = Math.hypot(dx, dz),
              dot = (dx * forward.x + dz * forward.z) / (distance || 1);
            return { point: p, distance, dot };
          })
          .filter(
            (item) =>
              item.distance >= 1 &&
              item.distance <= 6 &&
              item.dot >= 0.65 &&
              Math.abs(item.point.y - floor.y) <= 0.25,
          )
          .sort(
            (a, b) =>
              Math.abs(a.distance - 2.5) +
              (1 - a.dot) * 3 -
              (Math.abs(b.distance - 2.5) + (1 - b.dot) * 3),
          );
        if (candidates[0]) {
          point = candidates[0].point;
          source = "sweep";
        }
      }
    }
    const context: SpatialScanContext = {
      modelId,
      placementAvailable: Boolean(point),
      ...(point ? { floorPoint: { ...point }, floorPointSource: source } : {}),
      ...(pose &&
      finite(pose.position) &&
      Number.isFinite(pose.rotation.x) &&
      Number.isFinite(pose.rotation.y)
        ? {
            camera: {
              position: { ...pose.position },
              rotation: { ...pose.rotation },
              ...(pose.sweep ? { sweepId: pose.sweep } : {}),
            },
          }
        : {}),
    };
    const signature = JSON.stringify(context, (_key, value) =>
      typeof value === "number" ? Math.round(value * 100) / 100 : value,
    );
    if (signature === lastSignature) return;
    lastSignature = signature;
    if (options.throttleMs === 0) onChange(context);
    else {
      pending = context;
      if (!timer)
        timer = setTimeout(() => {
          timer = undefined;
          if (!disposed && pending) onChange(pending);
        }, options.throttleMs ?? 100);
    }
  };
  const subscriptions: Subscription[] = [];
  subscriptions.push(
    sdk.Camera.pose.subscribe((next) => {
      if (next.sweep !== pose?.sweep) pointer = undefined;
      pose = next;
      emit();
    }),
  );
  if (sdk.Sweep?.current)
    subscriptions.push(
      sdk.Sweep.current.subscribe((next) => {
        current = next;
        emit();
      }),
    );
  if (sdk.Sweep?.data)
    subscriptions.push(
      sdk.Sweep.data.subscribe({
        onCollectionUpdated: (rows) => {
          sweeps = Object.values(rows);
          emit();
        },
      }),
    );
  if (sdk.Pointer)
    subscriptions.push(
      sdk.Pointer.intersection.subscribe((next) => {
        pointer = next;
        emit();
      }),
    );
  emit();
  return () => {
    disposed = true;
    if (timer) clearTimeout(timer);
    subscriptions.forEach((subscription) => subscription.cancel());
  };
}
