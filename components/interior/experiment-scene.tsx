"use client";

import { Canvas, useLoader } from "@react-three/fiber";
import { Component, Suspense, useMemo, type ReactNode } from "react";
import { GLTFLoader } from "three/examples/jsm/loaders/GLTFLoader.js";
import { FURNITURE_CATALOG } from "@/lib/furniture/catalog";
import type { SpatialDraft } from "@/lib/contracts/spatial";

class ModelBoundary extends Component<
  { children: ReactNode; fallback: ReactNode },
  { failed: boolean }
> {
  state = { failed: false };
  static getDerivedStateFromError() {
    return { failed: true };
  }
  render() {
    return this.state.failed ? this.props.fallback : this.props.children;
  }
}
function Furniture({
  item,
  selected,
  onSelect,
}: {
  item: SpatialDraft["items"][number];
  selected: boolean;
  onSelect: () => void;
}) {
  const catalog = FURNITURE_CATALOG.find((c) => c.id === item.catalogId)!;
  const proxy = (
    <mesh position={[0, catalog.heightM / 2, 0]}>
      <boxGeometry args={[catalog.widthM, catalog.heightM, catalog.depthM]} />
      <meshStandardMaterial color={selected ? "#a7f3d0" : "#b69c7b"} />
    </mesh>
  );
  return (
    <group
      position={[item.x, 0, item.z]}
      rotation={[0, (item.rotation * Math.PI) / 180, 0]}
      onClick={(event) => {
        event.stopPropagation();
        onSelect();
      }}
    >
      <ModelBoundary fallback={proxy}>
        <Suspense fallback={proxy}>
          <Asset url={catalog.assetUrl} offset={catalog.modelOffsetM} />
        </Suspense>
      </ModelBoundary>
      {selected && (
        <mesh position={[0, 0.025, 0]} rotation={[-Math.PI / 2, 0, 0]}>
          <ringGeometry
            args={[
              Math.max(catalog.widthM, catalog.depthM) * 0.58,
              Math.max(catalog.widthM, catalog.depthM) * 0.58 + 0.06,
              32,
            ]}
          />
          <meshBasicMaterial color="#a7f3d0" />
        </mesh>
      )}
    </group>
  );
}
function Asset({
  url,
  offset,
}: {
  url: string;
  offset: readonly [number, number, number];
}) {
  const { scene } = useLoader(GLTFLoader, url);
  const model = useMemo(() => scene.clone(true), [scene]);
  return (
    <group position={[...offset]}>
      <primitive object={model} />
    </group>
  );
}
export default function ExperimentScene({
  draft,
  selected,
  onSelect,
  people = [],
  onCustomerSelect,
}: {
  people?: {
    id: string;
    x: number;
    z: number;
    role: "customer" | "employee";
  }[];
  onCustomerSelect?: (id: string) => void;
  draft: SpatialDraft;
  selected: string;
  onSelect: (id: string) => void;
}) {
  const { widthM: w, depthM: d } = draft.room;
  const fallback = (
    <p className="p-4 text-sm">
      3D unavailable. Use the floor plan and item controls below.
    </p>
  );
  return (
    <ModelBoundary fallback={fallback}>
      <div
        style={{ height: 280, background: "#1c2525", borderRadius: 12 }}
        aria-label="Proposed furniture in 3D"
      >
        <Canvas
          camera={{
            position: [w * 0.9, Math.max(w, d) * 1.2, d * 1.3],
            fov: 45,
          }}
          onCreated={({ camera }) => camera.lookAt(w / 2, 0, d / 2)}
          frameloop="demand"
        >
          <ambientLight intensity={1.6} />
          <directionalLight position={[2, 10, 3]} intensity={2} />
          <mesh
            position={[w / 2, -0.04, d / 2]}
            rotation={[-Math.PI / 2, 0, 0]}
          >
            <planeGeometry args={[w, d]} />
            <meshStandardMaterial color="#56615b" />
          </mesh>
          <gridHelper
            args={[
              Math.max(w, d),
              Math.round(Math.max(w, d)),
              "#76877d",
              "#657268",
            ]}
            position={[w / 2, 0, d / 2]}
          />
          {people.map((person) => (
            <mesh
              key={person.id}
              position={[person.x, 0.25, person.z]}
              onClick={() => onCustomerSelect?.(person.id)}
            >
              <sphereGeometry args={[0.16, 12, 12]} />
              <meshStandardMaterial
                color={person.role === "customer" ? "#93c5fd" : "#c4b5fd"}
              />
            </mesh>
          ))}
          {draft.items.map((item) => (
            <Furniture
              key={item.id}
              item={item}
              selected={selected === item.id}
              onSelect={() => onSelect(item.id)}
            />
          ))}
          <mesh position={[draft.servicePoint.x, 0.5, draft.servicePoint.z]}>
            <boxGeometry args={[1, 1, 0.6]} />
            <meshStandardMaterial color="#9fceb8" />
          </mesh>
        </Canvas>
      </div>
    </ModelBoundary>
  );
}
