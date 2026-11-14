"use client";

import { Canvas } from "@react-three/fiber";
import { Component, useSyncExternalStore, type ReactNode } from "react";

const FALLBACK = "The 3D layout needs WebGL. Customer details are available below.";
const fallback = <p className="p-4">{FALLBACK}</p>;

let webglSupport: boolean | undefined;
/** True when this browser can create a WebGL context (checked once). */
function hasWebGL() {
  if (webglSupport === undefined) {
    try {
      const canvas = document.createElement("canvas");
      webglSupport = Boolean(canvas.getContext("webgl2") ?? canvas.getContext("webgl"));
    } catch {
      webglSupport = false;
    }
  }
  return webglSupport;
}
const subscribe = () => () => {};

/** HAC-103: a renderer that still fails (lost context, driver error) shows the fallback, not the route error page. */
class WebGLBoundary extends Component<{ children: ReactNode }, { failed: boolean }> {
  state = { failed: false };
  static getDerivedStateFromError() {
    return { failed: true };
  }
  render() {
    return this.state.failed ? fallback : this.props.children;
  }
}

export default function FloorPlan(props: Parameters<typeof FloorPlanCanvas>[0]) {
  const supported = useSyncExternalStore(subscribe, hasWebGL, () => false);
  if (!supported) return fallback;
  return (
    <WebGLBoundary>
      <FloorPlanCanvas {...props} />
    </WebGLBoundary>
  );
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
    <Canvas
      orthographic
      camera={{ position: [0, 11, 8], zoom: 37 }}
      fallback={fallback}
    >
      <mesh rotation={[-Math.PI / 2, 0, 0]}>
        <planeGeometry args={[9, 7]} />
        <meshBasicMaterial color="#e2efdf" />
      </mesh>
      {Array.from({ length: stations }, (_, index) => (
        <mesh key={index} position={[index * 2.5 - 1.25, 0.35, -1.45]}>
          <boxGeometry args={[1.9, 0.7, 0.85]} />
          <meshBasicMaterial color="#1b4937" />
        </mesh>
      ))}
      {customers.map(({ id, x, z }) => (
        <mesh
          key={id}
          position={[x, 0.35, z]}
          onClick={(event) => {
            event.stopPropagation();
            select(id);
          }}
        >
          <sphereGeometry args={[0.27, 16, 12]} />
          <meshBasicMaterial color={id === selected ? "#b05317" : "#407baf"} />
        </mesh>
      ))}
    </Canvas>
  );
}
