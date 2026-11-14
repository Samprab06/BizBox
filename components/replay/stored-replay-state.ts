import type { SiteRun } from "@/lib/contracts";

type StoredEvent = SiteRun["events"][number];

/** Stable ordering retains the source event sequence when timestamps coincide. */
export function orderedStoredEvents(events: readonly StoredEvent[]) {
  return [...events].sort((a, b) => a.minute - b.minute);
}

/** Canonical 'served' starts service; 'departed' completes it. */
export function storedReplayAt(events: readonly StoredEvent[], minute: number) {
  const arrivals = new Set<string>();
  const waiting = new Set<string>();
  const serving = new Map<string, number>();
  const completed = new Set<string>();
  const abandoned = new Set<string>();
  for (const event of events) {
    if (event.minute > minute) break;
    const id = event.customerId;
    switch (event.type) {
      case "arrived":
        arrivals.add(id);
        break;
      case "joined":
        waiting.add(id);
        break;
      case "served": {
        waiting.delete(id);
        if (!serving.has(id)) {
          const occupied = new Set(serving.values());
          let lane = 0;
          while (occupied.has(lane)) lane++;
          serving.set(id, lane);
        }
        break;
      }
      case "departed":
        waiting.delete(id);
        serving.delete(id);
        completed.add(id);
        break;
      case "abandoned":
        waiting.delete(id);
        serving.delete(id);
        abandoned.add(id);
        break;
    }
  }
  return {
    arrivals: [...arrivals],
    waiting: [...waiting],
    serving: [...serving],
    served: completed.size,
    left: abandoned.size,
  };
}

/** Display lanes reflect peak concurrent service, not a measured floor plan. */
export function storedReplayStations(events: readonly StoredEvent[]) {
  const serving = new Set<string>();
  let peak = 0;
  for (const event of events) {
    if (event.type === "served") serving.add(event.customerId);
    if (event.type === "departed" || event.type === "abandoned")
      serving.delete(event.customerId);
    peak = Math.max(peak, serving.size);
  }
  return Math.max(1, peak);
}

/** Hourly rows define a playback window, not the founder's exact opening hours. */
export function storedReplayBounds(
  events: readonly StoredEvent[],
  hourly: readonly { hour: number }[],
) {
  let first = Infinity;
  let last = -Infinity;
  for (const row of hourly) {
    first = Math.min(first, row.hour * 60);
    last = Math.max(last, (row.hour + 1) * 60);
  }
  for (const event of events) {
    first = Math.min(first, event.minute);
    last = Math.max(last, event.minute);
  }
  const openMin = Number.isFinite(first) ? first : 0;
  const closeMin = Number.isFinite(last) ? last : openMin + 1;
  return { openMin, closeMin: Math.max(openMin + 1, closeMin) };
}
