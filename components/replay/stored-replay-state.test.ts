import { describe, expect, it } from "vitest";
import type { SiteRun } from "@/lib/contracts";
import {
  orderedStoredEvents,
  storedReplayAt,
  storedReplayBounds,
  storedReplayStations,
} from "./stored-replay-state";

const events: SiteRun["events"] = [
  { customerId: "a", minute: 420, type: "arrived" },
  { customerId: "a", minute: 420, type: "joined" },
  { customerId: "a", minute: 421, type: "served" },
  { customerId: "b", minute: 422, type: "arrived" },
  { customerId: "b", minute: 422, type: "joined" },
  { customerId: "b", minute: 423, type: "served" },
  { customerId: "a", minute: 425, type: "departed" },
  { customerId: "c", minute: 426, type: "arrived" },
  { customerId: "c", minute: 426, type: "abandoned" },
  { customerId: "b", minute: 428, type: "departed" },
];

describe("stored canonical replay", () => {
  it("treats served as service start and departed as completed", () => {
    const frame = storedReplayAt(events, 423);
    expect(frame.waiting).toEqual([]);
    expect(frame.serving).toEqual([
      ["a", 0],
      ["b", 1],
    ]);
    expect(frame.served).toBe(0);
    expect(storedReplayAt(events, 425).served).toBe(1);
    expect(storedReplayAt(events, 428)).toMatchObject({
      served: 2,
      left: 1,
      serving: [],
    });
  });

  it("is deterministic when seeking backwards and preserves equal-minute event order", () => {
    const ordered = orderedStoredEvents([...events].reverse());
    expect(ordered.map((e) => e.minute)).toEqual(
      [...events].map((e) => e.minute),
    );
    const before = storedReplayAt(events, 422);
    storedReplayAt(events, 428);
    expect(storedReplayAt(events, 422)).toEqual(before);
    expect(storedReplayStations(events)).toBe(2);
    expect(storedReplayAt(events, 419).arrivals).toEqual([]);
  });

  it("uses an explicit hourly playback window without dropping late events", () => {
    expect(storedReplayBounds(events, [{ hour: 7 }, { hour: 18 }])).toEqual({
      openMin: 420,
      closeMin: 1140,
    });
    expect(
      storedReplayBounds(
        [{ customerId: "late", minute: 1150, type: "departed" }],
        [{ hour: 18 }],
      ),
    ).toEqual({ openMin: 1080, closeMin: 1150 });
    expect(storedReplayBounds([], [])).toEqual({ openMin: 0, closeMin: 1 });
  });
});
