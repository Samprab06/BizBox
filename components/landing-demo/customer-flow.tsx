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
  // Each path includes entrance, queue, service and exit. No permanently
  // positioned customer dots: congestion is slower progress through the queue.
  const first = "M335 880 Q600 820 800 730 L980 665 L1040 650 Q900 815 350 900";
  const second =
    "M335 880 Q600 700 800 575 L950 510 L1010 485 Q800 800 350 900";
  const counters = proposed
    ? [
        { x: 1076, y: 622, staffX: 1170, staffY: 630 },
        { x: 1027, y: 483, staffX: 1110, staffY: 465 },
      ]
    : [{ x: 1076, y: 622, staffX: 1170, staffY: 630 }];
  const duration = proposed ? 12 : 20;
  return (
    <svg
      ref={svg}
      className={styles.customerFlow}
      viewBox="0 0 1586 992"
      preserveAspectRatio="xMidYMid meet"
      aria-label={`Illustrative customer flow with ${counters.length} staffed checkout${proposed ? "s" : ""}`}
      role="img"
      data-flow-running={running}
    >
      <path d={first} className={styles.routePath} />
      {proposed && <path d={second} className={styles.routePath} />}
      {Array.from({ length: 10 }, (_, i) => (
        <circle
          key={i}
          r="13"
          className={styles.customer}
          data-customer={i + 1}
        >
          <animateMotion
            dur={`${duration}s`}
            begin={`${-(i * duration) / 10}s`}
            repeatCount="indefinite"
            calcMode="linear"
            keyPoints="0;0.3;0.48;0.53;0.57;1"
            keyTimes={
              proposed ? "0;0.25;0.45;0.58;0.68;1" : "0;0.18;0.6;0.76;0.83;1"
            }
            path={proposed && i % 2 ? second : first}
          />
        </circle>
      ))}
      {counters.map((counter, i) => (
        <g key={i}>
          <g
            data-staff={i + 1}
            transform={`translate(${counter.staffX} ${counter.staffY})`}
          >
            <circle r="22" className={styles.employee} />
            <circle cy="-6" r="5" fill="#34204d" />
            <path d="M-10 12 Q-10 0 0 0 Q10 0 10 12Z" fill="#34204d" />
          </g>
          <g
            data-counter={i + 1}
            transform={`translate(${counter.x} ${counter.y})`}
          >
            <circle r="34" className={styles.station} />
            <circle
              cx="-30"
              cy="-27"
              r="19"
              fill="#163e36"
              stroke="#b9ffdb"
              strokeWidth="2"
            />
            <text
              x="-30"
              y="-20"
              textAnchor="middle"
              fontSize="21"
              fontWeight="600"
              fill="#fff"
            >
              {i + 1}
            </text>
          </g>
        </g>
      ))}
    </svg>
  );
});
