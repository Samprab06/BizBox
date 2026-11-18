"use client";

import { colorValue } from "@/lib/design/tokens";
import { Canvas, useThree } from "@react-three/fiber";
import {
  Component,
  useEffect,
  useRef,
  useState,
  useSyncExternalStore,
  type ReactNode,
  type RefObject,
} from "react";
import { OrbitControls } from "three/addons/controls/OrbitControls.js";

const FALLBACK =
  "The 3D layout needs WebGL. Customer details are available below.";
const fallback = <p className="p-4">{FALLBACK}</p>;

let webglSupport: boolean | undefined;
/** True when this browser can create a WebGL context (checked once). */
function hasWebGL() {
  if (webglSupport === undefined) {
    try {
      const canvas = document.createElement("canvas");
      webglSupport = Boolean(
        canvas.getContext("webgl2") ?? canvas.getContext("webgl"),
      );
    } catch {
      webglSupport = false;
    }
  }
  return webglSupport;
}
const subscribe = () => () => {};

/** HAC-124: phones and tablets, where a swipe on the canvas should scroll the page. */
const coarseQuery = "(pointer: coarse)";
function subscribeCoarse(onChange: () => void) {
  const query = window.matchMedia(coarseQuery);
  query.addEventListener("change", onChange);
  return () => query.removeEventListener("change", onChange);
}
const isCoarse = () => window.matchMedia(coarseQuery).matches;

/** HAC-103: a renderer that still fails (lost context, driver error) shows the fallback, not the route error page. */
class WebGLBoundary extends Component<
  { children: ReactNode },
  { failed: boolean }
> {
  state = { failed: false };
  static getDerivedStateFromError() {
    return { failed: true };
  }
  render() {
    return this.state.failed ? fallback : this.props.children;
  }
}

export default function FloorPlan(
  props: Parameters<typeof FloorPlanCanvas>[0],
) {
  const supported = useSyncExternalStore(subscribe, hasWebGL, () => false);
  if (!supported) return fallback;
  return (
    <WebGLBoundary>
      <FloorPlanCanvas {...props} />
    </WebGLBoundary>
  );
}

function ReplayCamera({
  controlsRef,
  enabled,
}: {
  controlsRef: RefObject<OrbitControls | null>;
  /** False on touch screens until the camera is switched on, so swipes scroll the page. */
  enabled: boolean;
}) {
  const camera = useThree((state) => state.camera);
  const canvas = useThree((state) => state.gl.domElement);

  useEffect(() => {
    const controls = new OrbitControls(camera, canvas);
    controls.enablePan = false;
    controls.minZoom = 15;
    controls.maxZoom = 85;
    controls.minPolarAngle = 0.1;
    controls.maxPolarAngle = Math.PI / 2 - 0.15;
    controls.saveState();
    // The camera transform remains observable even when a headless browser's
    // WebGL canvas cannot be captured. Keep the interaction contract independent
    // of GPU readback and publish each OrbitControls change for diagnostics.
    const publishCamera = () => {
      if (!controls.domElement) return;
      controls.domElement.dataset.cameraState = JSON.stringify({
        position: camera.position.toArray(),
        quaternion: camera.quaternion.toArray(),
        zoom: camera.zoom,
      });
    };
    controls.addEventListener("change", publishCamera);
    publishCamera();
    controlsRef.current = controls;
    return () => {
      controls.removeEventListener("change", publishCamera);
      if (controls.domElement) delete controls.domElement.dataset.cameraState;
      controlsRef.current = null;
      controls.dispose();
    };
  }, [camera, canvas, controlsRef]);

  // OrbitControls sets `touch-action: none`, which traps a page scroll that starts on the
  // canvas. While the camera is off, ignore pointer input and let vertical swipes scroll.
  useEffect(() => {
    if (!controlsRef.current) return;
    controlsRef.current.enabled = enabled;
    controlsRef.current.domElement?.style.setProperty(
      "touch-action",
      enabled ? "none" : "pan-y",
    );
  }, [enabled, canvas, controlsRef, camera]);

  return null;
}

function FloorPlanCanvas({
  waiting,
  serving,
  stations,
  selected,
  select,
}: {
  waiting: string[];
  serving: [string, number][];
  stations: number;
  selected: string;
  select: (id: string) => void;
}) {
  const controls = useRef<OrbitControls>(null);
  const touch = useSyncExternalStore(subscribeCoarse, isCoarse, () => false);
  const [moving, setMoving] = useState(false);
  const cameraOn = !touch || moving;
  const customers = [
    ...waiting.map((id, index) => ({
      id,
      x: -3 + (index % 8) * 0.8,
      z: 1 + Math.floor(index / 8) * 0.6,
    })),
    ...serving.map(([id, station]) => ({
      id,
      x: station * 2.5 - 1.25,
      z: -0.3,
    })),
  ];
  return (
    <div className="relative h-full">
      <Canvas
        orthographic
        camera={{ position: [0, 11, 8], zoom: 37 }}
        fallback={fallback}
      >
        <ReplayCamera controlsRef={controls} enabled={cameraOn} />
        <mesh rotation={[-Math.PI / 2, 0, 0]}>
          <planeGeometry args={[9, 7]} />
          <meshBasicMaterial color={colorValue("panel-raised")} />
        </mesh>
        {Array.from({ length: stations }, (_, index) => (
          <mesh key={index} position={[index * 2.5 - 1.25, 0.35, -1.45]}>
            <boxGeometry args={[1.9, 0.7, 0.85]} />
            <meshBasicMaterial color={colorValue("muted")} />
          </mesh>
        ))}
        {customers.map(({ id, x, z }) => (
          <mesh
            key={id}
            position={[x, 0.35, z]}
            onClick={(event) => {
              event.stopPropagation();
              if (event.delta <= 2) select(id);
            }}
          >
            <sphereGeometry args={[0.27, 16, 12]} />
            <meshBasicMaterial
              color={colorValue(id === selected ? "warn" : "accent")}
            />
          </mesh>
        ))}
      </Canvas>
      <div className="absolute right-2 top-2 flex gap-2">
        {touch && (
          <button
            type="button"
            aria-pressed={moving}
            className={`whitespace-nowrap rounded-lg border px-3 py-2 text-sm font-medium ${moving ? "border-accent bg-accent hover:bg-accent-hover text-on-accent" : "border-line bg-canvas text-accent"}`}
            onClick={() => setMoving(!moving)}
          >
            {moving ? (
              <>
                Done<span className="sr-only"> moving camera</span>
              </>
            ) : (
              "Move camera"
            )}
          </button>
        )}
        <button
          type="button"
          className="rounded-lg border border-line bg-canvas px-3 py-2 text-sm font-medium text-accent"
          onClick={() => controls.current?.reset()}
        >
          Reset camera
        </button>
      </div>
      {touch && moving && (
        <p className="absolute bottom-2 left-2 rounded bg-canvas/90 px-2 py-1 text-xs text-muted">
          Drag to orbit · pinch to zoom
        </p>
      )}
    </div>
  );
}
