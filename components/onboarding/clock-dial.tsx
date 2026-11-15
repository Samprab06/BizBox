"use client";

import { useEffect, useRef, useState, type KeyboardEvent, type PointerEvent } from "react";
import {
  DAY,
  MINUTES_PER_DEGREE,
  STEP,
  formatSpan,
  formatTime,
  handleLimits,
  handleToLimit,
  hourLabel,
  pointToAngle,
  presets,
  rubberBand,
  settle,
  stepHandle,
  turnBetween,
  wheelAngle,
  wheelLabelStyle,
  type Handle,
  type HoursRange,
} from "./clock-dial-math";

// The wheel is drawn in a 360×196 box: a circle centred on the bottom edge, top half shown.
const WIDTH = 360;
const HEIGHT = 196;
const CX = WIDTH / 2;
const CY = HEIGHT;
const RIM = 176;
const TICK_OUTER = 168;
const LABEL_R = 134;
const HOURS = Array.from({ length: 24 }, (_, hour) => hour);
const QUARTERS = Array.from({ length: DAY / STEP }, (_, index) => index * STEP);

const names: Record<Handle, { label: string; verb: string; tab: string }> = {
  open: { label: "Opening time", verb: "Opens", tab: "Opens" },
  close: { label: "Closing time", verb: "Closes", tab: "Closes" },
};

const reducedMotion = () => typeof window !== "undefined" && window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;

/**
 * HAC-160: the business-hours question as a rotating half-wheel. The numbered face turns
 * under a fixed marker at the top, like an iOS time picker bent into a dial; labels grow
 * at the marker and sink behind the glass panel below. The founder picks the opening time
 * first, then the closing time. A fling keeps spinning and springs to the nearest 15
 * minutes. The parent owns the value; this only reports snapped changes.
 */
export function ClockDial({
  value,
  onChange,
  labelledBy,
  describedBy,
}: {
  value: HoursRange;
  onChange: (value: HoursRange) => void;
  labelledBy?: string;
  describedBy?: string;
}) {
  const [phase, setPhase] = useState<Handle>("open");
  const target = value[phase];
  const { min, max } = handleLimits(value, phase);

  // The wheel's live position (minutes at the marker). Kept in a ref and mirrored to state
  // once per frame, so a drag or spin never waits on React.
  const position = useRef(target);
  const [shown, setShown] = useState(target);
  const frame = useRef<number | null>(null);
  const held = useRef<{ id: number; angle: number; raw: number; time: number; velocity: number } | null>(null);
  const coasting = useRef(false);
  const wheel = useRef<HTMLDivElement>(null);
  const latest = useRef({ value, phase, onChange });
  useEffect(() => {
    latest.current = { value, phase, onChange };
  });

  const paint = (next: number) => {
    position.current = next;
    setShown(next);
  };

  const stop = () => {
    if (frame.current !== null) cancelAnimationFrame(frame.current);
    frame.current = null;
    coasting.current = false;
  };

  /** Eases the wheel to a time (a spring without overshoot), or jumps under reduced motion. */
  const glide = (to: number) => {
    stop();
    if (reducedMotion()) return paint(to);
    let last = performance.now();
    const tick = (now: number) => {
      const dt = Math.min(0.05, (now - last) / 1000);
      last = now;
      const next = position.current + (to - position.current) * (1 - Math.exp(-dt * 11));
      if (Math.abs(to - next) < 0.05) {
        paint(to);
        frame.current = null;
        return;
      }
      paint(next);
      frame.current = requestAnimationFrame(tick);
    };
    frame.current = requestAnimationFrame(tick);
  };

  const emit = (minute: number) => {
    const { value: current, phase: end, onChange: report } = latest.current;
    if (current[end] !== minute) report({ ...current, [end]: minute });
  };

  // Follow outside changes (keyboard, presets, switching phase) unless a hand is on the wheel.
  useEffect(() => {
    if (held.current || coasting.current) return;
    if (Math.abs(position.current - target) > 0.01) glide(target);
    // glide only reads refs; re-running on its identity would restart the spring every render.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [target, phase]);

  useEffect(() => stop, []);

  function pointerAngle(event: PointerEvent) {
    const box = wheel.current!.getBoundingClientRect();
    const scale = box.width / WIDTH;
    return pointToAngle(event.clientX - (box.left + CX * scale), event.clientY - (box.top + CY * scale));
  }

  function onPointerDown(event: PointerEvent<HTMLDivElement>) {
    if (!event.isPrimary || (event.pointerType === "mouse" && event.button !== 0)) return;
    event.preventDefault();
    stop();
    event.currentTarget.focus({ preventScroll: true });
    try {
      event.currentTarget.setPointerCapture(event.pointerId);
    } catch {
      // Synthetic pointers can't be captured; the drag still works while over the wheel.
    }
    held.current = { id: event.pointerId, angle: pointerAngle(event), raw: position.current, time: event.timeStamp, velocity: 0 };
  }

  function onPointerMove(event: PointerEvent<HTMLDivElement>) {
    const hold = held.current;
    if (!hold || hold.id !== event.pointerId) return;
    const angle = pointerAngle(event);
    // Turning the face clockwise brings earlier times under the marker.
    const delta = -turnBetween(hold.angle, angle) * MINUTES_PER_DEGREE;
    const dt = Math.max(1, event.timeStamp - hold.time);
    hold.velocity = hold.velocity * 0.6 + (delta / dt) * 0.4;
    hold.angle = angle;
    hold.time = event.timeStamp;
    hold.raw += delta;
    paint(rubberBand(hold.raw, min, max));
    emit(settle(hold.raw, min, max));
  }

  function onPointerUp(event: PointerEvent<HTMLDivElement>) {
    const hold = held.current;
    if (!hold || hold.id !== event.pointerId) return;
    held.current = null;
    if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId);
    const fling = event.timeStamp - hold.time < 80 ? hold.velocity : 0; // minutes per ms
    if (reducedMotion() || Math.abs(fling) < 0.05) {
      const end = settle(hold.raw, min, max);
      emit(end);
      return glide(end);
    }
    // Momentum: coast with friction, stop at a limit, then spring to the nearest 15 minutes.
    let velocity = fling * 1000;
    let raw = Math.min(max, Math.max(min, hold.raw));
    let last = performance.now();
    const coast = (now: number) => {
      const dt = Math.min(0.05, (now - last) / 1000);
      last = now;
      raw += velocity * dt;
      velocity *= Math.exp(-dt * 3.2);
      const out = raw < min || raw > max;
      if (out || Math.abs(velocity) < 25) {
        const end = settle(raw, min, max);
        frame.current = null;
        coasting.current = false;
        emit(end);
        return glide(end);
      }
      paint(raw);
      emit(settle(raw, min, max));
      frame.current = requestAnimationFrame(coast);
    };
    coasting.current = true;
    frame.current = requestAnimationFrame(coast);
  }

  function onKeyDown(event: KeyboardEvent<HTMLDivElement>) {
    const hour = event.shiftKey ? 4 : 1;
    const steps: Record<string, number> = { ArrowRight: hour, ArrowUp: hour, ArrowLeft: -hour, ArrowDown: -hour, PageUp: 4, PageDown: -4 };
    let next: HoursRange | undefined;
    if (event.key === "Home") next = handleToLimit(value, phase, "min");
    else if (event.key === "End") next = handleToLimit(value, phase, "max");
    else if (steps[event.key] !== undefined) next = stepHandle(value, phase, steps[event.key]!);
    if (!next) return;
    event.preventDefault();
    if (next[phase] !== value[phase]) onChange(next);
  }

  const full = value.close - value.open >= DAY;
  const timeText = (end: Handle, minute: number) => (end === "close" && minute === DAY ? "Midnight" : formatTime(minute));

  return (
    <div className="select-none">
      <div className="relative mx-auto w-full max-w-[400px]">
        <div
          ref={wheel}
          role="slider"
          tabIndex={0}
          aria-label={names[phase].label}
          aria-describedby={[labelledBy, describedBy].filter(Boolean).join(" ") || undefined}
          aria-valuemin={min}
          aria-valuemax={max}
          aria-valuenow={target}
          aria-valuetext={`${names[phase].verb} at ${timeText(phase, target)}`}
          onKeyDown={onKeyDown}
          onPointerDown={onPointerDown}
          onPointerMove={onPointerMove}
          onPointerUp={onPointerUp}
          onPointerCancel={onPointerUp}
          data-testid="clock-dial"
          className="relative cursor-grab touch-none rounded-t-full outline-none focus-visible:ring-2 focus-visible:ring-white/80 active:cursor-grabbing"
        >
          <svg viewBox={`0 0 ${WIDTH} ${HEIGHT}`} aria-hidden="true" className="block h-auto w-full overflow-visible">
            <defs>
              <radialGradient id="wheel-face" cx="50%" cy="100%" r="100%">
                <stop offset="0" stopColor="rgb(255 255 255 / 0.02)" />
                <stop offset="0.85" stopColor="rgb(255 255 255 / 0.07)" />
                <stop offset="1" stopColor="rgb(255 255 255 / 0.12)" />
              </radialGradient>
              <clipPath id="wheel-top-half">
                <rect x="-20" y="-20" width={WIDTH + 40} height={CY + 20} />
              </clipPath>
              <linearGradient id="wheel-marker" x1="0" y1="0" x2="0" y2="1">
                <stop offset="0" stopColor="#ffffff" />
                <stop offset="1" stopColor="#ffffff" stopOpacity="0" />
              </linearGradient>
            </defs>
            <path d={`M ${CX - RIM} ${CY} A ${RIM} ${RIM} 0 0 1 ${CX + RIM} ${CY} Z`} fill="url(#wheel-face)" stroke="rgb(255 255 255 / 0.22)" />
            <g clipPath="url(#wheel-top-half)">
            <g transform={`rotate(${-shown / MINUTES_PER_DEGREE} ${CX} ${CY})`}>
              {QUARTERS.map((minute) => {
                const hourMark = minute % 60 === 0;
                const major = minute % 180 === 0;
                const length = major ? 13 : hourMark ? 9 : 4;
                const angle = wheelAngle(minute, shown);
                if (Math.abs(angle) > 92) return null;
                const fade = wheelLabelStyle(angle).opacity;
                return (
                  <line
                    key={minute}
                    x1={CX}
                    y1={CY - TICK_OUTER}
                    x2={CX}
                    y2={CY - TICK_OUTER + length}
                    transform={`rotate(${minute / MINUTES_PER_DEGREE} ${CX} ${CY})`}
                    stroke="#edf3fc"
                    strokeOpacity={(hourMark ? 0.75 : 0.35) * Math.max(0.15, fade)}
                    strokeWidth={major ? 2 : hourMark ? 1.4 : 1}
                    strokeLinecap="round"
                  />
                );
              })}
              {HOURS.map((hour) => {
                const minute = hour * 60;
                const angle = wheelAngle(minute, shown);
                if (Math.abs(angle) > 92) return null;
                const style = wheelLabelStyle(angle);
                return (
                  <g key={hour} transform={`rotate(${minute / MINUTES_PER_DEGREE} ${CX} ${CY}) translate(${CX} ${CY - LABEL_R}) scale(${style.scale})`} opacity={style.opacity}>
                    <text textAnchor="middle" dominantBaseline="central" fontSize="15" fontWeight={Math.abs(angle) < 8 ? 700 : 500} fill="#f2f4f8" className="tabular-nums">
                      {hourLabel(hour)}
                    </text>
                  </g>
                );
              })}
            </g>
            </g>
            {/* The fixed marker: a notch on the rim and a soft lens behind the chosen label. */}
            <rect x={CX - 33} y={CY - LABEL_R - 19} width="66" height="38" rx="14" fill="rgb(255 255 255 / 0.07)" stroke="rgb(255 255 255 / 0.2)" />
            <path d={`M ${CX - 7} ${CY - RIM - 3} L ${CX + 7} ${CY - RIM - 3} L ${CX} ${CY - RIM + 8} Z`} fill="#ffffff" />
            <rect x={CX - 1} y={CY - RIM + 8} width="2" height={RIM - LABEL_R - 26} rx="1" fill="url(#wheel-marker)" />
          </svg>
        </div>

        {/* The glass panel the wheel sinks behind. */}
        <div className="relative z-10 -mt-[9%] rounded-[26px] border border-white/20 bg-[#10131b]/55 p-3 shadow-[0_18px_48px_-24px_rgb(0_0_0/0.6),inset_0_1px_0_rgb(255_255_255/0.15)] backdrop-blur-[12px] sm:p-4">
          <div role="group" aria-label="Choose which time to set" className="grid grid-cols-2 gap-2">
            {(["open", "close"] as const).map((end) => {
              const on = phase === end;
              return (
                <button
                  key={end}
                  type="button"
                  aria-pressed={on}
                  onClick={() => setPhase(end)}
                  className={`rounded-2xl px-3 py-2.5 text-left transition-colors focus-visible:outline-2 focus-visible:outline-white ${on ? "bg-white text-[#10131b]" : "bg-white/5 text-white hover:bg-white/10"}`}
                >
                  <span className={`block text-[11px] font-semibold uppercase tracking-[0.14em] ${on ? "text-[#10131b]/65" : "text-white/60"}`}>{names[end].tab}</span>
                  <span className="block text-xl font-semibold tabular-nums sm:text-2xl">{full && end === "close" ? "Midnight" : timeText(end, value[end])}</span>
                </button>
              );
            })}
          </div>
          <div className="mt-3 flex items-center justify-between gap-3 px-1 text-sm">
            <span className="text-white/70 tabular-nums">{full ? "Open 24 hours" : `${formatSpan(value)} open`}</span>
            {phase === "open" ? (
              <button type="button" onClick={() => setPhase("close")} className="rounded-full border border-white/30 px-3 py-1 font-medium text-white hover:bg-white/10 focus-visible:outline-2 focus-visible:outline-white">
                Set closing time <span aria-hidden="true">→</span>
              </button>
            ) : (
              <button type="button" onClick={() => setPhase("open")} className="rounded-full px-3 py-1 font-medium text-white/80 hover:bg-white/10 focus-visible:outline-2 focus-visible:outline-white">
                <span aria-hidden="true">←</span> Opening time
              </button>
            )}
          </div>
        </div>
      </div>

      <div role="group" aria-label="Common hours" className="mt-4 flex flex-wrap justify-center gap-2">
        {presets.map((preset) => {
          const on = value.open === preset.range.open && value.close === preset.range.close;
          return (
            <button
              key={preset.label}
              type="button"
              aria-pressed={on}
              onClick={() => onChange(preset.range)}
              className={`rounded-full border px-3 py-1.5 text-sm tabular-nums focus-visible:outline-2 focus-visible:outline-white ${on ? "border-white bg-white text-[#10131b]" : "border-white/30 text-white hover:bg-white/10"}`}
            >
              {preset.label}
            </button>
          );
        })}
      </div>
      <p className="sr-only" aria-live="polite">
        {full ? "Open 24 hours" : `${formatTime(value.open)} to ${timeText("close", value.close)}, ${formatSpan(value)}`}
      </p>
    </div>
  );
}
