"use client";
import { memo, useEffect, useRef } from "react";
import styles from "./landing-demo.module.css";
export const CustomerFlow = memo(function CustomerFlow({
  proposed,
  running,
}: {
  proposed: boolean;
  running: boolean;
}) {
  const svg = useRef<SVGSVGElement>(null);
  useEffect(() => {
    const element = svg.current;
    if (!element) return;
    if (running) element.unpauseAnimations?.();
    else element.pauseAnimations?.();
  }, [running]);
  const first =
    "M335 880 Q600 820 740 710 Q850 640 1040 650 L1110 700 Q800 850 350 900";
  const second =
    "M335 880 Q620 700 800 550 Q900 480 1010 485 L1070 530 Q800 800 350 900";
  return (
    <svg
      ref={svg}
      className={styles.customerFlow}
      viewBox="0 0 1586 992"
      preserveAspectRatio="xMidYMid meet"
      aria-label="Illustrative customer paths and staffed counters"
      role="img"
    >
      <path d={first} className={styles.routePath} />
      {proposed && <path d={second} className={styles.routePath} />}
      {Array.from({ length: proposed ? 8 : 5 }, (_, i) => (
        <circle key={i} r="9" className={styles.customer}>
          <animateMotion
            dur={`${8 + i * 0.7}s`}
            begin={`${-i * 1.3}s`}
            repeatCount="indefinite"
            path={proposed && i % 2 ? second : first}
          />
        </circle>
      ))}
      {Array.from({ length: proposed ? 3 : 8 }, (_, i) => (
        <circle
          key={`queue-${i}`}
          cx={1020 - i * 29}
          cy={650 + i * 9}
          r="9"
          className={styles.customer}
        />
      ))}
      <circle cx="1170" cy="630" r="12" className={styles.employee} />
      {proposed && (
        <circle cx="1100" cy="455" r="12" className={styles.employee} />
      )}
      <circle cx="1045" cy="650" r="25" className={styles.station} />
      {proposed && (
        <circle cx="1015" cy="485" r="25" className={styles.station} />
      )}
    </svg>
  );
});
