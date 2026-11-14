import { replayAt } from "@/components/replay/replay-state";
import type { DayResult } from "@/lib/sim/contracts";

export type PurchasePoint = { minute: number; served: number };

/** One local-clock frame. Callers supply one run per site from the same scenario/day. */
export function statsAt(runs: readonly DayResult[], requestedMinute: number) {
  const first = runs[0];
  if (!first || !Number.isFinite(requestedMinute))
    throw new RangeError("Playback statistics need a run and a finite minute");
  if (new Set(runs.map(({ siteId }) => siteId)).size !== runs.length)
    throw new RangeError("Area statistics require one run per distinct site");
  const { openMin, closeMin, dayType } = first.metrics;
  if (
    runs.some(
      ({ metrics }) =>
        metrics.openMin !== openMin ||
        metrics.closeMin !== closeMin ||
        metrics.dayType !== dayType,
    )
  )
    throw new RangeError(
      "Area statistics require matching opening hours and day type",
    );
  const minute = Math.min(closeMin, Math.max(openMin, requestedMinute));
  let served = 0;
  let walkAways = 0;
  let lineLength = 0;
  let longestWaitMin = 0;
  let revenueUsd = 0;
  const completions: number[] = [];
  for (const run of runs) {
    const frame = replayAt(run.events, minute);
    served += frame.served;
    walkAways += frame.left;
    lineLength += frame.waiting.length;
    for (const id of frame.waiting) {
      const arrival = frame.arrivals.get(id);
      if (arrival)
        longestWaitMin = Math.max(longestWaitMin, minute - arrival.timeMin);
    }
    for (const event of run.events) {
      if (event.timeMin > minute) break;
      if (event.type === "completion") {
        revenueUsd += event.revenueUsd;
        completions.push(event.timeMin);
      }
    }
  }
  completions.sort((a, b) => a - b);
  const purchases: PurchasePoint[] = [{ minute: openMin, served: 0 }];
  for (let i = 0; i < completions.length; i++)
    purchases.push({ minute: completions[i], served: i + 1 });
  purchases.push({ minute, served });
  return {
    minute,
    openMin,
    closeMin,
    served,
    walkAways,
    lineLength,
    longestWaitMin,
    revenueUsd,
    purchases,
  };
}
