"use client";

import { Canvas, useThree } from "@react-three/fiber";
import { Component, useEffect, useRef } from "react";
import type { ReactNode } from "react";
import {
  MeshStandardMaterial,
  OrthographicCamera,
  SphereGeometry,
  TorusGeometry,
} from "three";
import type { RenderQuality } from "./render-policy";
import { useSceneVisibility } from "./use-scene-visibility";
import type { DayResult } from "@/lib/sim/contracts";
import { interiorFrame, stationPosition } from "./interior-state";

// Shared across both panels and every frame; dots have no independent animation loops.
const sphere = new SphereGeometry(0.18, 12, 8);
const ring = new TorusGeometry(0.26, 0.035, 5, 16);
const customerMaterial = new MeshStandardMaterial({
  color: "#60a5fa",
  roughness: 0.7,
});
const employeeMaterial = new MeshStandardMaterial({
  color: "#c084fc",
  roughness: 0.7,
});
const outlineMaterial = new MeshStandardMaterial({ color: "#f8fafc" });

function Unavailable() {
  return (
    <p className="p-5 text-sm text-white/60">
      3D requires WebGL. Shared playback, results and person inspection remain
      available below.
    </p>
  );
}

class SceneBoundary extends Component<
  { children: ReactNode },
  { failed: boolean }
> {
  state = { failed: false };
  static getDerivedStateFromError() {
    return { failed: true };
  }
  render() {
    return this.state.failed ? <Unavailable /> : this.props.children;
  }
}

function fitCamera(camera: OrthographicCamera, zoom: number) {
  camera.zoom = zoom;
  camera.updateProjectionMatrix();
}

function CameraSize({ cutaway }: { cutaway: boolean }) {
  const { camera, size, invalidate } = useThree();
  useEffect(() => {
    if (!(camera instanceof OrthographicCamera)) return;
    fitCamera(
      camera,
      Math.min(
        size.width / (cutaway ? 10 : 20),
        size.height / (cutaway ? 8 : 14),
      ),
    );
    invalidate();
  }, [camera, size.width, size.height, cutaway, invalidate]);
  return null;
}

function Block({
  at,
  size,
  color,
}: {
  at: [number, number, number];
  size: [number, number, number];
  color: string;
}) {
  return (
    <mesh position={at}>
      <boxGeometry args={size} />
      <meshStandardMaterial color={color} />
    </mesh>
  );
}

export default function Scene({
  run,
  minute,
  cutaway,
  selected,
  select,
  quality = "balanced",
  employeeCount,
}: {
  run: DayResult;
  minute: number;
  cutaway: boolean;
  selected: string;
  select: (id: string) => void;
  quality?: RenderQuality;
  employeeCount?: number;
}) {
  const container = useRef<HTMLDivElement>(null);
  const { visible, hasBeenVisible } = useSceneVisibility(container);
  const frame = interiorFrame(run, minute, employeeCount);
  return (
    <div ref={container} className="h-full w-full">
      {hasBeenVisible && (
        <SceneBoundary>
          <Canvas
            frameloop={visible ? "demand" : "never"}
            orthographic
            camera={{ position: [0, 28, 12], zoom: 22 }}
            dpr={quality === "balanced" ? 1 : [1, 1.5]}
            fallback={<Unavailable />}
          >
            <CameraSize cutaway={cutaway} />
            <ambientLight intensity={1.65} />
            <directionalLight position={[4, 10, 7]} intensity={2} />
            <Block at={[0, -0.16, 0]} size={[24, 0.2, 14]} color="#cdd3c2" />
            <Block
              at={[0, -0.05, 5.6]}
              size={[24, 0.17, 3.3]}
              color="#505956"
            />
            <Block
              at={[0, 0.02, 3.3]}
              size={[24, 0.18, 1.45]}
              color="#ded7c7"
            />
            {!cutaway &&
              [-8.5, 8.5].map((x) => (
                <Block
                  key={x}
                  at={[x, 1, -1.5]}
                  size={[3.4, 2, 5]}
                  color="#719283"
                />
              ))}
            <Block at={[0, 0.03, -0.5]} size={[8, 0.25, 6]} color="#f0dfbd" />
            <Block at={[0, 0.1, 1.3]} size={[5.8, 0.12, 2.8]} color="#ddcbaa" />
            <Block at={[0, 1.2, -3.45]} size={[8, 2.3, 0.16]} color="#537466" />
            <Block
              at={[-3.95, 0.8, -0.55]}
              size={[0.15, 1.5, 5.8]}
              color="#719283"
            />
            <Block
              at={[3.95, 0.8, -0.55]}
              size={[0.15, 1.5, 5.8]}
              color="#719283"
            />
            {/* Open front is a deliberate cutaway, not a claim about a scanned property. */}
            <Block
              at={[-2.5, 0.14, 2.45]}
              size={[2.7, 0.12, 0.12]}
              color="#537466"
            />
            <Block
              at={[2.5, 0.14, 2.45]}
              size={[2.7, 0.12, 0.12]}
              color="#537466"
            />
            <Block
              at={[0, 0.15, 2.7]}
              size={[1.4, 0.05, 1.1]}
              color="#b9c9b8"
            />
            {Array.from({ length: run.metrics.stations }, (_, index) => (
              <Block
                key={index}
                at={[stationPosition(index, run.metrics.stations), 0.55, -1.55]}
                size={[Math.min(2.1, 5 / run.metrics.stations), 1, 0.8]}
                color="#24584a"
              />
            ))}
            {frame.customers.map(({ id, x, z }) => (
              <group key={id} position={[x, 0.4, z]}>
                <mesh
                  geometry={sphere}
                  material={customerMaterial}
                  dispose={null}
                  onClick={(event) => {
                    event.stopPropagation();
                    select(id);
                  }}
                />
                {selected === id && (
                  <mesh
                    geometry={ring}
                    material={outlineMaterial}
                    dispose={null}
                    rotation={[-Math.PI / 2, 0, 0]}
                  />
                )}
              </group>
            ))}
            {frame.employees.map(({ id, x, z }) => (
              <group
                key={id}
                position={[x, 0.4, z]}
                onClick={(event) => {
                  event.stopPropagation();
                  select(id);
                }}
              >
                <mesh
                  geometry={sphere}
                  material={employeeMaterial}
                  dispose={null}
                />
                <mesh
                  geometry={ring}
                  material={outlineMaterial}
                  dispose={null}
                  rotation={[-Math.PI / 2, 0, 0]}
                  scale={selected === id ? 1.35 : 1}
                />
              </group>
            ))}
          </Canvas>
        </SceneBoundary>
      )}
    </div>
  );
}
