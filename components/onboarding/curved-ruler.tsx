"use client";

import {
  useEffect,
  useRef,
  useState,
  type KeyboardEvent,
  type PointerEvent,
} from "react";
import { focusRing } from "@/components/ui/cn";
import { money, nudge } from "./flow";

const SPACE = 14; // px between detents
const HEIGHT = 92;

/**
 * HAC-127: GetA5-style curved ruler. Dragging moves the ruler under a fixed centre marker,
 * arrow/Page/Home/End keys step between detents, and the exact typed amount (owned by the
 * parent) is never rounded: detents are UI aids only.
 */
export function CurvedRuler({
  value,
  min,
  max,
  step,
  currency,
  label,
  onChange,
}: {
  /** The current exact number, or NaN while the typed text is not a number. */
  value: number;
  min: number;
  max: number;
  step: number;
  currency: boolean;
  label: string;
  onChange: (value: number) => void;
}) {
  const surface = useRef<HTMLDivElement>(null);
  const [width, setWidth] = useState(320);
  const drag = useRef<{
    id: number;
    x: number;
    start: number;
    moved: boolean;
  } | null>(null);
  const shown = Number.isFinite(value)
    ? Math.min(max, Math.max(min, value))
    : min;
  const format = (amount: number) =>
    currency ? money(amount) : String(amount);

  useEffect(() => {
    const element = surface.current;
    if (!element || typeof ResizeObserver === "undefined") return;
    const observer = new ResizeObserver(([entry]) => {
      if (entry) setWidth(Math.max(120, Math.round(entry.contentRect.width)));
    });
    observer.observe(element);
    return () => observer.disconnect();
  }, []);

  const clamp = (amount: number) => Math.min(max, Math.max(min, amount));
  const snap = (amount: number) =>
    clamp(Math.round((amount - min) / step) * step + min);
  const emit = (amount: number) => {
    if (amount !== value) onChange(amount);
  };

  function onKeyDown(event: KeyboardEvent<HTMLDivElement>) {
    const moves: Record<string, [1 | -1, number]> = {
      ArrowRight: [1, 1],
      ArrowUp: [1, 1],
      ArrowLeft: [-1, 1],
      ArrowDown: [-1, 1],
      PageUp: [1, 10],
      PageDown: [-1, 10],
    };
    let next: number | undefined;
    if (event.key === "Home") next = min;
    else if (event.key === "End") next = max;
    else if (moves[event.key]) {
      const [direction, detents] = moves[event.key]!;
      next = clamp(nudge(shown, step, min, direction, detents));
    }
    if (next === undefined) return;
    event.preventDefault();
    emit(next);
  }

  function onPointerDown(event: PointerEvent<HTMLDivElement>) {
    if (!event.isPrimary || event.button !== 0) return;
    event.preventDefault();
    event.currentTarget.focus({ preventScroll: true });
    event.currentTarget.setPointerCapture(event.pointerId);
    drag.current = {
      id: event.pointerId,
      x: event.clientX,
      start: shown,
      moved: false,
    };
  }

  function onPointerMove(event: PointerEvent<HTMLDivElement>) {
    const held = drag.current;
    if (!held || held.id !== event.pointerId) return;
    const dx = event.clientX - held.x;
    if (Math.abs(dx) > 3) held.moved = true;
    if (held.moved) emit(snap(held.start - (dx / SPACE) * step));
  }

  function onPointerUp(event: PointerEvent<HTMLDivElement>) {
    const held = drag.current;
    if (!held || held.id !== event.pointerId) return;
    drag.current = null;
    if (event.currentTarget.hasPointerCapture(event.pointerId))
      event.currentTarget.releasePointerCapture(event.pointerId);
    if (!held.moved && event.type === "pointerup") {
      // A tap moves the ruler to the tapped tick.
      const box = event.currentTarget.getBoundingClientRect();
      emit(
        snap(
          shown + ((event.clientX - box.left - box.width / 2) / SPACE) * step,
        ),
      );
    }
  }

  const middle = width / 2;
  const radius = width * 0.72;
  const index = (shown - min) / step;
  const ticks: {
    key: number;
    x: number;
    y: number;
    length: number;
    opacity: number;
    label?: string;
  }[] = [];
  const half = Math.ceil(width / SPACE / 2) + 3;
  for (let i = Math.floor(index) - half; i <= Math.ceil(index) + half; i++) {
    const amount = min + i * step;
    if (amount < min || amount > max) continue;
    const angle = ((i - index) * SPACE) / radius;
    if (Math.abs(angle) > 1.35) continue;
    const x = middle + Math.sin(angle) * radius;
    if (x < 0 || x > width) continue;
    const major = i % 5 === 0;
    const opacity = Math.pow(Math.max(0, Math.cos(angle)), 3) * 0.85;
    const compact =
      currency && amount >= 1000
        ? `${Number((amount / 1000).toFixed(1))}k`
        : String(amount);
    ticks.push({
      key: i,
      x,
      y: 14 + (1 - Math.cos(angle)) * 18,
      length: (major ? 26 : 12) * Math.cos(angle),
      opacity,
      label: major ? compact : undefined,
    });
  }

  return (
    <div className="select-none text-ink">
      <div
        ref={surface}
        role="slider"
        tabIndex={0}
        aria-label={label}
        aria-valuemin={min}
        aria-valuemax={max}
        aria-valuenow={shown}
        aria-valuetext={Number.isFinite(value) ? format(value) : "Not set"}
        onKeyDown={onKeyDown}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerCancel={onPointerUp}
        className={`relative h-[92px] cursor-grab touch-none rounded-control active:cursor-grabbing ${focusRing}`}
      >
        <svg
          width={width}
          height={HEIGHT}
          viewBox={`0 0 ${width} ${HEIGHT}`}
          aria-hidden="true"
          className="absolute inset-0"
        >
          {ticks.map((tick) => (
            <g key={tick.key} opacity={tick.opacity}>
              <line
                x1={tick.x}
                y1={tick.y}
                x2={tick.x}
                y2={tick.y + tick.length}
                stroke="currentColor"
                strokeWidth={tick.label ? 1.8 : 1}
              />
              {tick.label && (
                <text
                  x={tick.x}
                  y={tick.y + 50}
                  textAnchor="middle"
                  fontSize="11"
                  fill="currentColor"
                >
                  {tick.label}
                </text>
              )}
            </g>
          ))}
        </svg>
        <span
          aria-hidden="true"
          className="absolute left-1/2 top-1 h-10 w-0.5 -translate-x-1/2 rounded-full bg-accent"
        />
      </div>
      <div
        aria-hidden="true"
        className="mt-1 flex justify-between text-xs text-muted"
      >
        <span>{format(min)}</span>
        <span>{format(max)}</span>
      </div>
    </div>
  );
}
