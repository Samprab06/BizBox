"use client";

import { Canvas } from "@react-three/fiber";
import type { DayResult } from "@/lib/sim/contracts";
import { replayAt } from "../replay/replay-state";

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
    <mesh position={at} castShadow receiveShadow>
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
}: {
  run: DayResult;
  minute: number;
  cutaway: boolean;
  selected: string;
  select: (id: string) => void;
}) {
  const frame = replayAt(run.events, minute);
  const approaching = run.events.flatMap((event) => {
    if (
      event.type !== "arrival" ||
      event.timeMin <= minute ||
      event.timeMin > minute + 2
    )
      return [];
    const remaining = (event.timeMin - minute) / 2;
    return [{ id: event.customerId, x: remaining * -9, z: 3.5 }];
  });
  const people = [
    ...approaching,
    ...frame.waiting.map((id, i) => ({
      id,
      x: -3 + (i % 7),
      z: 1.2 - Math.floor(i / 7) * 0.52,
    })),
    ...frame.serving.map(([id, station]) => ({
      id,
      x: station * 2.8 - 1.4,
      z: -0.6,
    })),
  ];

  return (
    <Canvas
      orthographic
      camera={{ position: [0, 16, 20], zoom: cutaway ? 41 : 22 }}
      dpr={[1, 1.5]}
      fallback={
        <p className="p-4 text-sm text-white/50">
          3D requires WebGL. The clock, totals, and event inspector are
          available below.
        </p>
      }
    >
      <ambientLight intensity={1.65} />
      <directionalLight position={[4, 10, 7]} intensity={2} />
      <Block at={[0, -0.16, 0]} size={[32, 0.2, 23]} color="#cdd3c2" />
      <Block at={[0, -0.05, 5.6]} size={[32, 0.17, 3.3]} color="#505956" />
      <Block at={[0, 0.02, 3.3]} size={[32, 0.18, 1.45]} color="#ded7c7" />
      {[-12, -8, -4, 0, 4, 8, 12].map((x) => (
        <Block
          key={x}
          at={[x, 0.045, 5.6]}
          size={[1.3, 0.02, 0.07]}
          color="#e4d5a8"
        />
      ))}
      {!cutaway &&
        [-11, -7, 7, 11].map((x, i) => (
          <Block
            key={x}
            at={[x, 1 + (i % 2), -1.5]}
            size={[3.4, 2 + 2 * (i % 2), 5]}
            color={i % 2 ? "#6f8178" : "#9b9c87"}
          />
        ))}
      <Block at={[0, 0.03, -0.5]} size={[8, 0.25, 6]} color="#f0dfbd" />
      <Block at={[0, 1.2, -3.45]} size={[8, 2.3, 0.16]} color="#537466" />
      <Block at={[-3.95, 0.8, -0.55]} size={[0.15, 1.5, 5.8]} color="#719283" />
      <Block at={[3.95, 0.8, -0.55]} size={[0.15, 1.5, 5.8]} color="#719283" />
      <Block at={[0, 1.85, 2.42]} size={[8.25, 0.22, 0.52]} color="#ae5432" />
      {Array.from({ length: run.metrics.stations }, (_, i) => (
        <Block
          key={i}
          at={[i * 2.8 - 1.4, 0.55, -1.55]}
          size={[2.1, 1, 0.8]}
          color="#24584a"
        />
      ))}
      {[0, 1, 2, 3, 4].map((i) => {
        const direction = i % 2 === 0 ? 1 : -1;
        const x = (((minute * 1.8 + i * 7) % 30) - 15) * direction;
        return (
          <Block
            key={i}
            at={[x, 0.26, 5.6 + direction * 0.7]}
            size={[1.1, 0.4, 0.56]}
            color={i % 2 ? "#e2b46b" : "#9bb8ce"}
          />
        );
      })}
      {people.map(({ id, x, z }) => (
        <mesh
          key={id}
          position={[x, 0.4, z]}
          onClick={(event) => {
            event.stopPropagation();
            select(id);
          }}
        >
          <capsuleGeometry args={[0.15, 0.38, 4, 8]} />
          <meshStandardMaterial
            color={id === selected ? "#d56734" : "#2c5274"}
          />
        </mesh>
      ))}
    </Canvas>
  );
}
