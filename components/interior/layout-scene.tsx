"use client";

import { Canvas, useThree, type ThreeEvent } from "@react-three/fiber";
import {
  Component,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import type { ReactNode } from "react";
import {
  BufferGeometry,
  Color,
  InstancedMesh,
  Line,
  LineBasicMaterial,
  MeshBasicMaterial,
  MeshStandardMaterial,
  Object3D,
  OrthographicCamera,
  SphereGeometry,
  SRGBColorSpace,
  TextureLoader,
  TorusGeometry,
  Vector3,
  type Texture,
} from "three";
import type { InteriorLayout } from "@/lib/sim/interior-layout";
import { useSceneVisibility } from "../simulator/use-scene-visibility";
import type { InteriorAgent } from "./interior-replay";

// Shared across mounts; one InstancedMesh per role keeps draw calls flat at 200+ agents.
const sphere = new SphereGeometry(0.22, 12, 8);
const ring = new TorusGeometry(0.34, 0.04, 5, 20);
const roleMaterial = {
  customer: new MeshStandardMaterial({ color: "#60a5fa", roughness: 0.7 }),
  employee: new MeshStandardMaterial({ color: "#c084fc", roughness: 0.7 }),
};
const selectionMaterial = new MeshStandardMaterial({ color: "#f8fafc" });
const stationMaterial = new MeshBasicMaterial({
  color: "#a5b4fc",
  transparent: true,
  opacity: 0.8,
});
const entranceMaterial = new MeshBasicMaterial({ color: "#fbbf24" });
const queueMaterial = new LineBasicMaterial({ color: "#a5b4fc" });
const scratch = new Object3D();

function Unavailable() {
  return (
    <p className="p-5 text-sm text-white/60">
      3D requires WebGL. Shared playback, counts and person inspection remain
      available.
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

function fitCamera(
  camera: OrthographicCamera,
  { minX, maxX, minZ, maxZ }: InteriorLayout["bounds"],
  size: { width: number; height: number },
) {
  const cx = (minX + maxX) / 2;
  const cz = (minZ + maxZ) / 2;
  camera.position.set(cx, 30, cz + 14);
  camera.lookAt(new Vector3(cx, 0, cz));
  // Leave room for the outside point and a margin around the bounds.
  camera.zoom = Math.max(
    4,
    Math.min(size.width / (maxX - minX + 6), size.height / (maxZ - minZ + 6)),
  );
  camera.updateProjectionMatrix();
}

function FitCamera({ layout }: { layout: InteriorLayout }) {
  const { camera, size, invalidate } = useThree();
  const { minX, maxX, minZ, maxZ } = layout.bounds;
  const { width, height } = size;
  useEffect(() => {
    if (!(camera instanceof OrthographicCamera)) return;
    fitCamera(camera, { minX, maxX, minZ, maxZ }, { width, height });
    invalidate();
  }, [camera, width, height, minX, maxX, minZ, maxZ, invalidate]);
  return null;
}

function Floor({
  layout,
  texture,
}: {
  layout: InteriorLayout;
  texture: Texture | null;
}) {
  const { minX, maxX, minZ, maxZ } = layout.bounds;
  return (
    <mesh
      position={[(minX + maxX) / 2, layout.floorY - 0.01, (minZ + maxZ) / 2]}
      rotation={[-Math.PI / 2, 0, 0]}
    >
      <planeGeometry args={[maxX - minX, maxZ - minZ]} />
      {texture ? (
        <meshBasicMaterial map={texture} />
      ) : (
        <meshStandardMaterial color="#2b2f45" />
      )}
    </mesh>
  );
}

function Markers({ layout }: { layout: InteriorLayout }) {
  const { from, to } = layout.counter;
  const length = Math.hypot(to.x - from.x, to.z - from.z);
  const angle = Math.atan2(to.z - from.z, to.x - from.x);
  const queue = useMemo(() => {
    const geometry = new BufferGeometry().setFromPoints(
      layout.queue.map((p) => new Vector3(p.x, layout.floorY + 0.02, p.z)),
    );
    return new Line(geometry, queueMaterial);
  }, [layout]);
  useEffect(() => () => queue.geometry.dispose(), [queue]);
  const y = layout.floorY;
  return (
    <>
      <mesh
        position={[(from.x + to.x) / 2, y + 0.45, (from.z + to.z) / 2]}
        rotation={[0, -angle, 0]}
      >
        <boxGeometry args={[Math.max(0.2, length), 0.9, 0.6]} />
        <meshStandardMaterial color="#4c5578" transparent opacity={0.85} />
      </mesh>
      {layout.stations.map((p, index) => (
        <mesh
          key={index}
          geometry={ring}
          material={stationMaterial}
          position={[p.x, y + 0.02, p.z]}
          rotation={[-Math.PI / 2, 0, 0]}
          dispose={null}
        />
      ))}
      <mesh
        position={[layout.entrance.x, y + 0.02, layout.entrance.z]}
        rotation={[-Math.PI / 2, 0, 0]}
        material={entranceMaterial}
      >
        <circleGeometry args={[0.35, 20]} />
      </mesh>
      <primitive object={queue} />
    </>
  );
}

function RoleInstances({
  agents,
  role,
  floorY,
  select,
}: {
  agents: readonly InteriorAgent[];
  role: InteriorAgent["role"];
  floorY: number;
  select: (id: string) => void;
}) {
  const people = agents.filter((agent) => agent.role === role);
  // Capacity grows in powers of two so the mesh is rebuilt rarely, never per frame.
  const capacity = 2 ** Math.ceil(Math.log2(Math.max(16, people.length)));
  const mesh = useRef<InstancedMesh>(null);
  const ids = useRef<string[]>([]);
  const invalidate = useThree((state) => state.invalidate);
  useLayoutEffect(() => {
    const instances = mesh.current;
    if (!instances) return;
    ids.current = people.map((person) => person.id);
    people.forEach((person, index) => {
      scratch.position.set(person.x, floorY + 0.22, person.z);
      scratch.updateMatrix();
      instances.setMatrixAt(index, scratch.matrix);
    });
    instances.count = people.length;
    instances.instanceMatrix.needsUpdate = true;
    instances.computeBoundingSphere();
    invalidate();
  });
  return (
    <instancedMesh
      key={capacity}
      ref={mesh}
      args={[sphere, roleMaterial[role], capacity]}
      dispose={null}
      onClick={(event: ThreeEvent<MouseEvent>) => {
        event.stopPropagation();
        const id =
          event.instanceId === undefined
            ? undefined
            : ids.current[event.instanceId];
        if (id) select(id);
      }}
    />
  );
}

function useFloorTexture(uri: string | undefined) {
  const [state, setState] = useState<{
    uri?: string;
    texture: Texture | null;
    failed: boolean;
  }>({ texture: null, failed: false });
  useEffect(() => {
    if (!uri) return;
    let disposed = false;
    let loaded: Texture | null = null;
    const loader = new TextureLoader();
    loader.setCrossOrigin("anonymous");
    loader.load(
      uri,
      (texture) => {
        texture.colorSpace = SRGBColorSpace;
        if (disposed) return texture.dispose();
        loaded = texture;
        setState({ uri, texture, failed: false });
      },
      undefined,
      () => {
        if (!disposed) setState({ uri, texture: null, failed: true });
      },
    );
    return () => {
      disposed = true;
      loaded?.dispose();
    };
  }, [uri]);
  return state.uri === uri ? state : { texture: null, failed: false };
}

/**
 * The r3f room for the "Listing floor plan" and "Modeled layout" sources: the
 * layout's floor (with the floor-plan image as its ground texture when given),
 * counter, station and entrance markers, the queue path and simulation agents.
 */
export default function LayoutScene({
  layout,
  agents,
  selected,
  select,
  floorPlanUri,
  onFloorPlanFailed,
}: {
  layout: InteriorLayout;
  agents: readonly InteriorAgent[];
  selected: string;
  select: (id: string) => void;
  floorPlanUri?: string;
  onFloorPlanFailed?: () => void;
}) {
  const container = useRef<HTMLDivElement>(null);
  const { visible, hasBeenVisible } = useSceneVisibility(container);
  const floor = useFloorTexture(floorPlanUri);
  const failed = floor.failed;
  useEffect(() => {
    if (failed) onFloorPlanFailed?.();
  }, [failed, onFloorPlanFailed]);
  const chosen = agents.find((agent) => agent.id === selected);
  return (
    <div ref={container} className="h-full w-full">
      {hasBeenVisible && (
        <SceneBoundary>
          <Canvas
            frameloop={visible ? "demand" : "never"}
            orthographic
            camera={{ position: [0, 30, 14], zoom: 20 }}
            dpr={1}
            fallback={<Unavailable />}
            onCreated={({ scene }) => {
              scene.background = new Color("#141726");
            }}
          >
            <FitCamera layout={layout} />
            <ambientLight intensity={1.6} />
            <directionalLight position={[4, 10, 7]} intensity={1.8} />
            <Floor layout={layout} texture={floor.texture} />
            <Markers layout={layout} />
            <RoleInstances
              agents={agents}
              role="customer"
              floorY={layout.floorY}
              select={select}
            />
            <RoleInstances
              agents={agents}
              role="employee"
              floorY={layout.floorY}
              select={select}
            />
            {chosen && (
              <mesh
                geometry={ring}
                material={selectionMaterial}
                position={[chosen.x, layout.floorY + 0.03, chosen.z]}
                rotation={[-Math.PI / 2, 0, 0]}
                dispose={null}
              />
            )}
          </Canvas>
        </SceneBoundary>
      )}
    </div>
  );
}
