/**
 * HAC-77: what the city draws for one sampled minute. Pure and deterministic:
 * the same `TripFrame` always gives the same graphics, whatever the playback
 * speed or the order of seeks.
 */
import type { Position } from "@/lib/sim/trips";
import type { SampledAgent, TripFrame } from "./trip-frame";

/** Colors use only what is visible at this minute; future outcomes never leak. */
export const agentColors = {
  approaching: "#a5b4fc",
  waiting: "#818cf8",
  inService: "#c7d2fe",
  served: "#f1f5f9",
  left: "#f59e0b",
} as const;

export type AgentGraphic = {
  id: string;
  position: Position;
  color: string;
  trail: { position: Position; opacity: number }[];
};

export type AgentGraphics = {
  agents: AgentGraphic[];
  /** Ring at the door sized by the current line; null when nobody is waiting. */
  queue: { center: Position; radiusMeters: number; length: number } | null;
};

export function agentColor(agent: SampledAgent): string {
  if (agent.outcome === "served") return agentColors.served;
  if (agent.outcome === "balked" || agent.outcome === "reneged")
    return agentColors.left;
  if (agent.phase === "waiting") return agentColors.waiting;
  if (agent.phase === "in_service") return agentColors.inService;
  return agentColors.approaching;
}

export function queueRadiusMeters(length: number) {
  return length > 0 ? 3 + 1.25 * length : 0;
}

export function agentGraphics(frame: TripFrame, door: Position): AgentGraphics {
  return {
    agents: frame.agents.map((agent) => ({
      id: agent.customerId,
      position: agent.position,
      color: agentColor(agent),
      trail: agent.trail.map(({ position, opacity }) => ({
        position,
        opacity,
      })),
    })),
    queue:
      frame.queueLength > 0
        ? {
            center: door,
            radiusMeters: queueRadiusMeters(frame.queueLength),
            length: frame.queueLength,
          }
        : null,
  };
}
