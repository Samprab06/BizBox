"use client";
import { useEffect, useState } from "react";
import { countUpAt, RENT_COUNT_MS } from "./timeline";
import { dollars } from "./demo-ui";

/** Remount on selected focus so every reveal starts on one, without stale frames. */
export function RentValue({
  target,
  animate,
  reduced,
}: {
  target: number;
  animate: boolean;
  reduced: boolean;
}) {
  const [elapsed, setElapsed] = useState(0);
  useEffect(() => {
    if (!animate || reduced) return;
    let request = 0;
    const started = performance.now();
    const tick = (now: number) => {
      setElapsed(Math.min(RENT_COUNT_MS, now - started));
      if (now - started < RENT_COUNT_MS) request = requestAnimationFrame(tick);
    };
    request = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(request);
  }, [animate, reduced]);
  const value = animate ? countUpAt(elapsed, target, reduced) : target;
  return <strong data-rent-value={value}>{dollars(value)}</strong>;
}
