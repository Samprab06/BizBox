import { scanLayout } from "./scan-layout";
import type { ScanPlacement, ScanReplay } from "./matterport-scene";

/**
 * Typed camera bridge the consultant uses to drive the scanned interior (HAC-139).
 *
 * Three layers, so the camera logic stays testable without a Matterport key:
 * 1. `planCamera` maps one command and a snapshot of the viewer to SDK steps. Pure.
 * 2. `CameraController` runs commands in a queue, one transition at a time, locks
 *    founder navigation while it drives, and yields to any founder input.
 * 3. `connectMatterportCamera` adapts a connected Showcase SDK to `CameraPort`.
 */

export type Vec3 = { x: number; y: number; z: number };
export type CameraMode = "inside" | "dollhouse" | "floorplan";
export type Transition = "instant" | "fly";
export type SweepNode = {
  id: string;
  position: Vec3;
  neighbors: readonly string[];
  enabled: boolean;
};

export type CameraCommand =
  | { type: "gotoSweep"; sweepId: string; rotation?: { x: number; y: number } }
  /** Station index into the scanned layout's proposed counters. */
  | { type: "lookAtStation"; station: number }
  | { type: "setMode"; mode: CameraMode }
  | { type: "follow"; agentId: string }
  /** Minute of day on the shared playback clock. */
  | { type: "seek"; minute: number };

export type CameraStep =
  | {
      kind: "sweep";
      sweepId: string;
      rotation?: { x: number; y: number };
      transition: Transition;
    }
  | { kind: "lookAt"; position: Vec3; moveToClosestSweep: boolean }
  | { kind: "mode"; mode: CameraMode; transition: Transition }
  | { kind: "pan"; position: Vec3; transition: Transition }
  | { kind: "seek"; minute: number };

export type CameraContext = {
  mode: CameraMode;
  reducedMotion: boolean;
  sweeps: readonly SweepNode[];
  currentSweep: string | null;
  /** Scan-world positions of the proposed counters, by station index. */
  stations: readonly Vec3[];
  /** Scan-world positions of simulated people, by agent id. */
  agents: ReadonlyMap<string, Vec3>;
  /** Sensor reading for the follow target; undefined when no sensor is available. */
  targetVisible?: boolean;
  now: number;
  /** When follow last moved the camera; null on a fresh follow. */
  lastFollowAt: number | null;
};

/** Inside, follow hops between scan points; hopping more often than this is disorienting. */
export const INSIDE_FOLLOW_THROTTLE_MS = 1500;
/** Dollhouse follow pans smoothly, so it can update more often. */
export const DOLLHOUSE_FOLLOW_THROTTLE_MS = 250;

const distance = (a: Vec3, b: Vec3) =>
  Math.hypot(a.x - b.x, a.y - b.y, a.z - b.z);

/** Enabled scan points reachable from `from` through the sweep graph (all, if unknown). */
export function reachableSweeps(
  sweeps: readonly SweepNode[],
  from: string | null,
): SweepNode[] {
  const enabled = sweeps.filter((sweep) => sweep.enabled);
  const byId = new Map(enabled.map((sweep) => [sweep.id, sweep]));
  if (!from || !byId.has(from)) return enabled;
  const seen = new Set([from]);
  const queue = [from];
  while (queue.length) {
    const node = byId.get(queue.shift()!)!;
    for (const next of node.neighbors)
      if (byId.has(next) && !seen.has(next)) {
        seen.add(next);
        queue.push(next);
      }
  }
  return enabled.filter((sweep) => seen.has(sweep.id));
}

/** Nearest reachable, enabled scan point to `target`; ties keep the earlier sweep. */
export function nearestSweep(
  target: Vec3,
  sweeps: readonly SweepNode[],
  from: string | null = null,
): SweepNode | null {
  let best: SweepNode | null = null;
  let bestDistance = Infinity;
  for (const sweep of reachableSweeps(sweeps, from)) {
    const d = distance(target, sweep.position);
    if (d < bestDistance) {
      best = sweep;
      bestDistance = d;
    }
  }
  return best;
}

/** Pure command-to-camera mapping. `null` means the command cannot run here. */
export function planCamera(
  command: CameraCommand,
  context: CameraContext,
): CameraStep[] | null {
  const transition: Transition = context.reducedMotion ? "instant" : "fly";
  switch (command.type) {
    case "gotoSweep": {
      const known =
        context.sweeps.length === 0 ||
        context.sweeps.some(
          (sweep) => sweep.id === command.sweepId && sweep.enabled,
        );
      if (!known) return null;
      return [
        {
          kind: "sweep",
          sweepId: command.sweepId,
          ...(command.rotation ? { rotation: command.rotation } : {}),
          transition,
        },
      ];
    }
    case "lookAtStation": {
      const position = context.stations[command.station];
      if (!position) return null;
      // Camera.lookAt's own sweep move animates; reduced motion jumps first instead.
      if (context.reducedMotion && context.sweeps.length > 0) {
        const nearest = nearestSweep(position, context.sweeps);
        if (!nearest) return null;
        const steps: CameraStep[] = [];
        if (context.mode !== "inside" || nearest.id !== context.currentSweep)
          steps.push({
            kind: "sweep",
            sweepId: nearest.id,
            transition: "instant",
          });
        steps.push({ kind: "lookAt", position, moveToClosestSweep: false });
        return steps;
      }
      return [{ kind: "lookAt", position, moveToClosestSweep: true }];
    }
    case "setMode":
      return command.mode === context.mode
        ? []
        : [{ kind: "mode", mode: command.mode, transition }];
    case "follow": {
      const position = context.agents.get(command.agentId);
      if (!position) return null;
      const throttle =
        context.mode === "inside"
          ? INSIDE_FOLLOW_THROTTLE_MS
          : DOLLHOUSE_FOLLOW_THROTTLE_MS;
      if (
        context.lastFollowAt !== null &&
        context.now - context.lastFollowAt < throttle
      )
        return [];
      if (context.mode !== "inside")
        return [{ kind: "pan", position, transition }];
      // Inside: stay put while the sensor still sees the agent.
      if (context.targetVisible && context.lastFollowAt !== null) return [];
      const nearest = nearestSweep(
        position,
        context.sweeps,
        context.currentSweep,
      );
      const look: CameraStep = {
        kind: "lookAt",
        position,
        moveToClosestSweep: false,
      };
      if (!nearest || nearest.id === context.currentSweep) return [look];
      return [{ kind: "sweep", sweepId: nearest.id, transition }, look];
    }
    case "seek":
      return Number.isFinite(command.minute)
        ? [
            {
              kind: "seek",
              minute: Math.max(0, Math.min(1440, command.minute)),
            },
          ]
        : null;
  }
}

/** Scan-world position of a layout point, matching ReplayComponent's root transform. */
export function toScanWorld(
  placement: ScanPlacement,
  local: { x: number; z: number },
  height = 0.4,
): Vec3 {
  const cos = Math.cos(placement.rotationY);
  const sin = Math.sin(placement.rotationY);
  return {
    x: placement.origin.x + local.x * cos + local.z * sin,
    y: placement.origin.y + height,
    z: placement.origin.z - local.x * sin + local.z * cos,
  };
}

/** Where the replay's people and counters stand in the scan, for follow and lookAt. */
export function scanTargets(replay: ScanReplay, placement: ScanPlacement) {
  const layout = replay.projectedLayout ?? scanLayout(replay.frame, replay.stationCount);
  return {
    stations: layout.stations.map((station) =>
      toScanWorld(placement, station, 1),
    ),
    agents: new Map(
      layout.people.map((person) => [
        person.id,
        toScanWorld(placement, person),
      ]),
    ),
  };
}

export type CameraSnapshot = {
  mode: CameraMode;
  sweeps: readonly SweepNode[];
  currentSweep: string | null;
};

/** What the controller needs from a viewer. Implemented by the SDK adapter and mocks. */
export interface CameraPort {
  snapshot(): CameraSnapshot;
  gotoSweep(
    sweepId: string,
    rotation: { x: number; y: number } | undefined,
    transition: Transition,
  ): Promise<void>;
  lookAt(position: Vec3, moveToClosestSweep: boolean): Promise<void>;
  setMode(mode: CameraMode, transition: Transition): Promise<void>;
  pan(position: Vec3, transition: Transition): Promise<void>;
  /** The shared playback clock's setter. */
  seek(minute: number): void | Promise<void>;
  setNavigationLocked(locked: boolean): void;
  /** Points the visibility sensor at the follow target and returns its last reading. */
  trackTarget?(position: Vec3 | null): boolean | undefined;
}

export type CameraOutcome = "done" | "cancelled" | "failed";
export type CameraStatus = { driving: boolean; following: string | null };

export function runStep(port: CameraPort, step: CameraStep) {
  switch (step.kind) {
    case "sweep":
      return port.gotoSweep(step.sweepId, step.rotation, step.transition);
    case "lookAt":
      return port.lookAt(step.position, step.moveToClosestSweep);
    case "mode":
      return port.setMode(step.mode, step.transition);
    case "pan":
      return port.pan(step.position, step.transition);
    case "seek":
      return Promise.resolve(port.seek(step.minute));
  }
}

type Job = {
  command: CameraCommand;
  resolve: (outcome: CameraOutcome) => void;
};

export class CameraController {
  private queue: Job[] = [];
  private draining = false;
  private generation = 0;
  private following: string | null = null;
  private lastFollowAt: number | null = null;
  private locked = false;
  private waiters: Array<() => void> = [];
  /** The SDK transition still running; the next one waits for it, even after a cancel. */
  private inflight: Promise<unknown> = Promise.resolve();

  constructor(
    private port: CameraPort,
    private options: {
      targets: () => Pick<CameraContext, "stations" | "agents">;
      reducedMotion?: () => boolean;
      now?: () => number;
      onChange?: (status: CameraStatus) => void;
    },
  ) {}

  get status(): CameraStatus {
    return {
      driving: this.draining || this.queue.length > 0,
      following: this.following,
    };
  }

  /** Queues one command; resolves once it ran, failed or was cancelled. */
  run(command: CameraCommand): Promise<CameraOutcome> {
    return new Promise((resolve) => {
      this.queue.push({ command, resolve });
      this.setLocked(true);
      void this.drain();
    });
  }

  /** Re-plans an active follow; call it whenever the replay frame changes. */
  tick() {
    if (this.following && !this.draining && this.queue.length === 0)
      void this.run({ type: "follow", agentId: this.following });
  }

  /** Drops queued moves, stops following and returns navigation to the founder. */
  cancel() {
    this.generation++;
    this.following = null;
    this.lastFollowAt = null;
    this.port.trackTarget?.(null);
    for (const job of this.queue.splice(0)) job.resolve("cancelled");
    for (const wake of this.waiters.splice(0)) wake();
    this.setLocked(false);
    this.emit();
  }

  /** Any founder drag, scrub or navigation click: the founder takes over. */
  founderInput() {
    if (this.status.driving || this.following || this.locked) this.cancel();
  }

  dispose() {
    this.cancel();
  }

  private context(): CameraContext {
    const snapshot = this.port.snapshot();
    const targets = this.options.targets();
    const followTarget = this.following
      ? targets.agents.get(this.following)
      : undefined;
    return {
      ...snapshot,
      ...targets,
      reducedMotion: this.options.reducedMotion?.() ?? false,
      targetVisible: followTarget
        ? this.port.trackTarget?.(followTarget)
        : undefined,
      now: (this.options.now ?? Date.now)(),
      lastFollowAt: this.lastFollowAt,
    };
  }

  private async drain() {
    if (this.draining) return;
    this.draining = true;
    this.emit();
    while (this.queue.length) {
      const job = this.queue.shift()!;
      const generation = this.generation;
      const { command } = job;
      if (command.type === "follow" && command.agentId !== this.following) {
        this.following = command.agentId;
        this.lastFollowAt = null;
      } else if (
        command.type === "gotoSweep" ||
        command.type === "lookAtStation"
      )
        this.following = null;
      await this.inflight.catch(() => undefined);
      if (generation !== this.generation) {
        job.resolve("cancelled");
        continue;
      }
      const steps = planCamera(command, this.context());
      if (!steps) {
        if (command.type === "follow") this.following = null;
        job.resolve("failed");
        continue;
      }
      if (command.type === "follow" && steps.length)
        this.lastFollowAt = (this.options.now ?? Date.now)();
      let outcome: CameraOutcome = "done";
      for (const step of steps) {
        if (generation !== this.generation) {
          outcome = "cancelled";
          break;
        }
        const transition = (async () => runStep(this.port, step))();
        this.inflight = transition;
        // A cancel resolves the command at once; the SDK transition is left to settle.
        const result = await Promise.race([
          transition.then(
            () => "done" as const,
            () => "failed" as const,
          ),
          this.cancelled(generation),
        ]);
        if (result !== "done") {
          outcome = result;
          break;
        }
      }
      job.resolve(generation === this.generation ? outcome : "cancelled");
    }
    this.draining = false;
    if (!this.following) this.setLocked(false);
    this.emit();
  }

  private cancelled(generation: number) {
    return new Promise<"cancelled">((resolve) => {
      if (generation !== this.generation) resolve("cancelled");
      else this.waiters.push(() => resolve("cancelled"));
    });
  }

  private setLocked(locked: boolean) {
    if (locked === this.locked) return;
    this.locked = locked;
    this.port.setNavigationLocked(locked);
  }

  private emit() {
    this.options.onChange?.(this.status);
  }
}

/* ---------------------------------------------------------------------------
 * Showcase SDK adapter. Every SDK surface here is optional: a missing one makes
 * the matching command fail rather than break the viewer.
 * ------------------------------------------------------------------------- */

type Observable<T> = { subscribe(callback: T): { cancel(): void } };
type SdkSweep = {
  sid?: string;
  id?: string;
  position?: Vec3;
  neighbors?: string[];
  enabled?: boolean;
};
type SdkComponent = {
  inputs: Record<string, unknown>;
  spyOnEvent?(spy: { eventType: string; onEvent(): void }): {
    cancel?(): void;
  };
};
type SdkSource = { describeVolume?(volume: unknown): void; commit?(): void };
export type CameraSdk = {
  Sweep?: {
    moveTo(
      id: string,
      options: {
        rotation?: { x: number; y: number };
        transition: string;
      },
    ): Promise<unknown>;
    Transition: { INSTANT: string; FLY?: string };
    current?: Observable<(sweep: SdkSweep) => void>;
    data?: Observable<{
      onCollectionUpdated(collection: Record<string, SdkSweep>): void;
    }>;
  };
  Camera?: {
    lookAt?(
      position: Vec3,
      options?: { moveToClosestSweep?: boolean },
    ): Promise<unknown>;
    pan?(position: { x: number; z: number }): Promise<unknown>;
  };
  Mode?: {
    moveTo(mode: string, options?: { transition?: string }): Promise<unknown>;
    Mode?: { INSIDE: string; DOLLHOUSE: string; FLOORPLAN: string };
    TransitionType?: { INSTANT: string; FLY: string };
    current?: Observable<(mode: string) => void>;
  };
  Sensor?: {
    createSensor(type: string): Promise<{
      addSource(...sources: SdkSource[]): void;
      readings: Observable<{
        onUpdated(source: SdkSource, reading: { inView: boolean }): void;
      }>;
      dispose?(): void;
    }>;
    createSource(type: string, options: unknown): Promise<SdkSource>;
    SensorType?: { CAMERA: string };
    SourceType?: { SPHERE: string };
  };
  Scene?: {
    createObjects(count: number): Promise<
      Array<{
        addNode(): {
          addComponent(name: string, inputs: unknown): SdkComponent;
        };
        start(): void | Promise<void>;
        stop(): void;
      }>
    >;
  };
};

const sdkModes: Record<CameraMode, string> = {
  inside: "mode.inside",
  dollhouse: "mode.dollhouse",
  floorplan: "mode.floorplan",
};

/** Founder navigation events from `mp.input` that hand control back. */
const founderEvents = ["INPUT.DRAG_BEGIN", "INPUT.DRAG", "INPUT.SCROLL"];

export function connectMatterportCamera(
  sdk: CameraSdk,
  options: { seek: (minute: number) => void; onFounderInput: () => void },
): { port: CameraPort; dispose(): void } {
  const disposers: Array<() => void> = [];
  let disposed = false;
  let mode: CameraMode = "inside";
  let currentSweep: string | null = null;
  let sweeps: SweepNode[] = [];
  let locked = false;
  let input: SdkComponent | null = null;
  let visible: boolean | undefined;
  let source: SdkSource | null = null;
  const guard = (fn: () => void) => {
    try {
      fn();
    } catch {
      /* Optional SDK surface; the matching command fails instead. */
    }
  };
  const modeValue = (value: CameraMode) =>
    sdk.Mode?.Mode?.[value.toUpperCase() as "INSIDE"] ?? sdkModes[value];

  guard(() => {
    const sub = sdk.Mode?.current?.subscribe((value) => {
      const match = (Object.keys(sdkModes) as CameraMode[]).find(
        (key) => modeValue(key) === value,
      );
      if (match) mode = match;
    });
    if (sub) disposers.push(() => sub.cancel());
  });
  guard(() => {
    const sub = sdk.Sweep?.current?.subscribe((sweep) => {
      currentSweep = sweep.sid || sweep.id || null;
    });
    if (sub) disposers.push(() => sub.cancel());
  });
  guard(() => {
    // The sweep graph: each scan point with its navigable neighbours.
    const sub = sdk.Sweep?.data?.subscribe({
      onCollectionUpdated(collection) {
        sweeps = Object.entries(collection).flatMap(([key, sweep]) =>
          sweep.position
            ? [
                {
                  id: sweep.sid || sweep.id || key,
                  position: sweep.position,
                  neighbors: sweep.neighbors ?? [],
                  enabled: sweep.enabled !== false,
                },
              ]
            : [],
        );
      },
    });
    if (sub) disposers.push(() => sub.cancel());
  });
  void (async () => {
    try {
      const [object] = (await sdk.Scene?.createObjects(1)) ?? [];
      if (!object) return;
      if (disposed) return object.stop();
      const component = object.addNode().addComponent("mp.input", {
        eventsEnabled: true,
        userNavigationEnabled: !locked,
      });
      for (const eventType of founderEvents) {
        const spy = component.spyOnEvent?.({
          eventType,
          onEvent: () => {
            if (locked) options.onFounderInput();
          },
        });
        if (spy?.cancel) disposers.push(() => spy.cancel!());
      }
      await object.start();
      input = component;
      disposers.push(() => object.stop());
    } catch {
      /* Without mp.input the founder simply keeps navigation. */
    }
  })();
  void (async () => {
    try {
      const Sensor = sdk.Sensor;
      if (!Sensor) return;
      const sensor = await Sensor.createSensor(
        Sensor.SensorType?.CAMERA ?? "sensor.sensortype.camera",
      );
      const created = await Sensor.createSource(
        Sensor.SourceType?.SPHERE ?? "sensor.sourcetype.sphere",
        { origin: { x: 0, y: 0, z: 0 }, radius: 0.5 },
      );
      if (disposed) return sensor.dispose?.();
      sensor.addSource(created);
      const sub = sensor.readings.subscribe({
        onUpdated(_source, reading) {
          visible = reading.inView;
        },
      });
      source = created;
      disposers.push(() => {
        sub.cancel();
        sensor.dispose?.();
      });
    } catch {
      /* No sensor: follow hops on every throttled tick instead. */
    }
  })();

  const need = <T>(value: T | undefined, name: string): T => {
    if (value === undefined) throw new Error(`${name} unavailable`);
    return value;
  };
  const port: CameraPort = {
    snapshot: () => ({ mode, sweeps, currentSweep }),
    async gotoSweep(sweepId, rotation, transition) {
      const Sweep = need(sdk.Sweep, "Sweep navigation");
      await Sweep.moveTo(sweepId, {
        ...(rotation ? { rotation } : {}),
        transition:
          transition === "fly"
            ? (Sweep.Transition.FLY ?? "transition.fly")
            : Sweep.Transition.INSTANT,
      });
    },
    async lookAt(position, moveToClosestSweep) {
      const lookAt = need(sdk.Camera?.lookAt, "Camera.lookAt");
      await lookAt.call(sdk.Camera, position, { moveToClosestSweep });
    },
    async setMode(next, transition) {
      const Mode = need(sdk.Mode, "Mode");
      await Mode.moveTo(modeValue(next), {
        transition:
          transition === "fly"
            ? (Mode.TransitionType?.FLY ?? "transition.fly")
            : (Mode.TransitionType?.INSTANT ?? "transition.instant"),
      });
    },
    async pan(position, transition) {
      const camera = sdk.Camera;
      // Pan glides in dollhouse; reduced motion re-aims without the glide.
      if (transition === "fly" && camera?.pan)
        await camera.pan({ x: position.x, z: position.z });
      else
        await need(camera?.lookAt, "Camera.lookAt").call(camera, position, {
          moveToClosestSweep: false,
        });
    },
    seek: (minute) => options.seek(minute),
    setNavigationLocked(next) {
      locked = next;
      if (input) input.inputs.userNavigationEnabled = !next;
    },
    trackTarget(position) {
      if (!position || !source) {
        visible = undefined;
        return undefined;
      }
      guard(() => {
        source!.describeVolume?.({ origin: position, radius: 0.5 });
        source!.commit?.();
      });
      return visible;
    },
  };
  return {
    port,
    dispose() {
      disposed = true;
      port.setNavigationLocked(false);
      for (const dispose of disposers.splice(0)) guard(dispose);
    },
  };
}
