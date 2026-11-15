"use client";

import { useId, useRef, useState, type KeyboardEvent, type PointerEvent } from "react";
import {
  DAY,
  STEP,
  clockLabel,
  defaultHours,
  dialLabels,
  formatHours,
  hourPresets,
  minuteAt,
  moveEnd,
  nearestEnd,
  parseHours,
  pointAt,
  shiftRange,
  spanLabel,
  unwrap,
  type Hours,
} from "./hours";

const SIZE = 320;
const CENTER = SIZE / 2;
const FACE = 156;
const TICK_OUTER = 150;
const LABEL = 128;
const TRACK = 100;
const TRACK_WIDTH = 22;
const KNOB = 36;

type End = "open" | "close";
type Drag = { id: number; mode: End | "move"; pointer: number; start: Hours; hours: Hours };

/**
 * HAC-154: the business-hours question as a 24-hour watch face. Two glass knobs set the
 * opening and closing time and snap to 15 minutes; dragging the lit arc moves both. The
 * value is the intake hours text (owned by the parent), so a typed exact range and the
 * dial always agree.
 */
export function ClockDial({
  value,
  onChange,
  describedBy,
}: {
  /** The intake hours text, e.g. "9am – 5pm". */
  value: string;
  onChange: (value: string) => void;
  describedBy?: string;
}) {
  const id = useId();
  const face = useRef<HTMLDivElement>(null);
  const exact = useRef<HTMLInputElement>(null);
  const drag = useRef<Drag | null>(null);
  const [active, setActive] = useState<Drag["mode"] | null>(null);
  const parsed = parseHours(value);
  // While typed text is not a range yet, the dial keeps showing the last range it could read.
  const [lastValid, setLastValid] = useState<Hours>(parsed ?? defaultHours);
  if (parsed && (parsed.open !== lastValid.open || parsed.close !== lastValid.close)) setLastValid(parsed);
  const hours = parsed ?? lastValid;

  const emit = (next: Hours) => {
    if (next.open !== hours.open || next.close !== hours.close || !parsed) onChange(formatHours(next));
  };

  /** The pointer's minute on the dial, and how far it is from the centre as a share of the face. */
  function locate(event: PointerEvent<HTMLElement>) {
    const box = face.current!.getBoundingClientRect();
    const dx = event.clientX - (box.left + box.width / 2);
    const dy = event.clientY - (box.top + box.height / 2);
    return { minute: minuteAt(dx, dy), distance: Math.hypot(dx, dy) / (box.width / 2) };
  }

  function onPointerDown(event: PointerEvent<HTMLDivElement>) {
    if (!event.isPrimary || event.button !== 0) return;
    const { minute, distance } = locate(event);
    const target = (event.target as Element).closest<HTMLElement | SVGElement>("[data-dial]");
    const role = target?.dataset.dial;
    // The centre readout is its own button; only the ring moves the hours.
    if (role === "readout" || (!role && distance < (TRACK - TRACK_WIDTH) / CENTER)) return;
    event.preventDefault();
    const mode: Drag["mode"] = role === "open" || role === "close" || role === "move" ? role : nearestEnd(hours, minute);
    const pointer = mode === "move" ? unwrap(minute, (hours.open + hours.close) / 2) : unwrap(minute, hours[mode]);
    let next = hours;
    if (mode !== "move" && !role) {
      // A tap on the ring jumps the nearer end there, then keeps dragging it.
      next = moveEnd(hours, mode, pointer);
      emit(next);
    }
    const knob = mode === "move" ? null : face.current!.querySelector<HTMLElement>(`[data-dial="${mode}"]`);
    knob?.focus({ preventScroll: true });
    face.current!.setPointerCapture(event.pointerId);
    drag.current = { id: event.pointerId, mode, pointer, start: next, hours: next };
    setActive(mode);
  }

  function onPointerMove(event: PointerEvent<HTMLDivElement>) {
    const held = drag.current;
    if (!held || held.id !== event.pointerId) return;
    const { minute } = locate(event);
    let next: Hours;
    if (held.mode === "move") {
      const pointer = unwrap(minute, held.pointer);
      next = shiftRange(held.start, pointer - held.pointer);
    } else {
      held.pointer = unwrap(minute, held.pointer);
      next = moveEnd(held.hours, held.mode, held.pointer);
    }
    if (next.open !== held.hours.open || next.close !== held.hours.close) {
      held.hours = next;
      onChange(formatHours(next));
    }
  }

  function onPointerUp(event: PointerEvent<HTMLDivElement>) {
    const held = drag.current;
    if (!held || held.id !== event.pointerId) return;
    drag.current = null;
    if (face.current?.hasPointerCapture(event.pointerId)) face.current.releasePointerCapture(event.pointerId);
    setActive(null);
  }

  function onKeyDown(end: End, event: KeyboardEvent<HTMLDivElement>) {
    const big = event.shiftKey ? 60 : STEP;
    const moves: Record<string, number> = {
      ArrowRight: big,
      ArrowUp: big,
      ArrowLeft: -big,
      ArrowDown: -big,
      PageUp: 60,
      PageDown: -60,
    };
    let minute: number | undefined;
    if (event.key === "Home") minute = 0;
    else if (event.key === "End") minute = DAY;
    else if (moves[event.key] !== undefined) {
      // Step to the next 15-minute mark, so a typed 9:10 moves cleanly.
      const current = hours[end];
      const delta = moves[event.key]!;
      minute = delta > 0 ? Math.floor(current / STEP) * STEP + delta : Math.ceil(current / STEP) * STEP + delta;
    }
    if (minute === undefined) return;
    event.preventDefault();
    emit(moveEnd(hours, end, minute));
  }

  const percent = (n: number) => `${(n / SIZE) * 100}%`;
  const full = hours.close - hours.open >= DAY;
  const start = pointAt(hours.open, TRACK, SIZE);
  const end = pointAt(hours.close, TRACK, SIZE);
  const large = hours.close - hours.open > DAY / 2 ? 1 : 0;
  const arc = full
    ? `M ${CENTER} ${CENTER - TRACK} A ${TRACK} ${TRACK} 0 1 1 ${CENTER - 0.01} ${CENTER - TRACK}`
    : `M ${start.x} ${start.y} A ${TRACK} ${TRACK} 0 ${large} 1 ${end.x} ${end.y}`;

  const ticks = Array.from({ length: DAY / STEP }, (_, index) => {
    const minute = index * STEP;
    const major = minute % 180 === 0;
    const hour = minute % 60 === 0;
    const length = major ? 10 : hour ? 6 : 3;
    const outer = pointAt(minute, TICK_OUTER, SIZE);
    const inner = pointAt(minute, TICK_OUTER - length, SIZE);
    return { minute, outer, inner, major, opacity: major ? 0.85 : hour ? 0.5 : 0.2 };
  });

  const knob = (which: End) => {
    const minute = hours[which];
    const point = pointAt(minute, TRACK, SIZE);
    const label = which === "open" ? "Opening time" : "Closing time";
    const text = which === "open" ? `Opens at ${clockLabel(minute)}` : `Closes at ${minute === DAY ? "midnight" : clockLabel(minute)}`;
    return (
      <div
        key={which}
        role="slider"
        tabIndex={0}
        data-dial={which}
        data-active={active === which || active === "move" ? "true" : undefined}
        aria-label={label}
        aria-describedby={describedBy}
        aria-valuemin={which === "open" ? 0 : hours.open + 30}
        aria-valuemax={which === "open" ? hours.close - 30 : DAY}
        aria-valuenow={minute}
        aria-valuetext={text}
        onKeyDown={(event) => onKeyDown(which, event)}
        style={{ left: percent(point.x), top: percent(point.y), width: percent(KNOB), height: percent(KNOB) }}
        className={`absolute z-10 flex -translate-x-1/2 -translate-y-1/2 cursor-grab items-center justify-center rounded-full border shadow-[0_6px_18px_-6px_rgb(0_0_0/0.7)] outline-none focus-visible:ring-2 focus-visible:ring-white focus-visible:ring-offset-2 focus-visible:ring-offset-[#10131b] active:cursor-grabbing data-[active=true]:shadow-[0_0_0_6px_rgb(255_255_255/0.12),0_0_22px_rgb(255_236_210/0.55)] motion-safe:transition-[scale,box-shadow] motion-safe:duration-150 motion-safe:data-[active=true]:scale-110 ${
          which === "open" ? "border-white bg-white text-[#10131b]" : "border-white/80 bg-[#10131b]/75 text-white backdrop-blur-[12px]"
        }`}
      >
        {which === "open" ? <SunIcon /> : <MoonIcon />}
      </div>
    );
  };

  return (
    <div className="select-none">
      <div
        ref={face}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerCancel={onPointerUp}
        className={`@container relative mx-auto aspect-square w-full max-w-[320px] touch-none ${parsed ? "" : "opacity-60"}`}
      >
        <svg viewBox={`0 0 ${SIZE} ${SIZE}`} aria-hidden="true" className="absolute inset-0 h-full w-full overflow-visible">
          <defs>
            <linearGradient id={`${id}-arc`} x1="0" y1="0" x2={SIZE} y2={SIZE} gradientUnits="userSpaceOnUse">
              <stop offset="0" stopColor="#ffe3bd" />
              <stop offset="1" stopColor="#c9d7ff" />
            </linearGradient>
            <filter id={`${id}-glow`} x="-20%" y="-20%" width="140%" height="140%">
              <feGaussianBlur stdDeviation="7" />
            </filter>
          </defs>
          <circle cx={CENTER} cy={CENTER} r={FACE} fill="rgb(16 19 27 / 0.38)" stroke="rgb(255 255 255 / 0.2)" />
          <circle cx={CENTER} cy={CENTER} r={FACE - 1.5} fill="none" stroke="rgb(255 255 255 / 0.06)" strokeWidth="3" />
          {ticks.map((tick) => (
            <line
              key={tick.minute}
              x1={tick.inner.x}
              y1={tick.inner.y}
              x2={tick.outer.x}
              y2={tick.outer.y}
              stroke="#edf3fc"
              strokeOpacity={tick.opacity}
              strokeWidth={tick.major ? 1.8 : 1}
              strokeLinecap="round"
            />
          ))}
          {dialLabels.map((label) => {
            const point = pointAt(label.minute, LABEL, SIZE);
            return (
              <text key={label.minute} x={point.x} y={point.y} textAnchor="middle" dominantBaseline="central" fontSize="12" fontWeight="500" fill="#edf3fc" fillOpacity="0.85" className="tabular-nums">
                {label.text}
              </text>
            );
          })}
          <circle cx={CENTER} cy={CENTER} r={TRACK} fill="none" stroke="rgb(255 255 255 / 0.08)" strokeWidth={TRACK_WIDTH} />
          <path d={arc} fill="none" stroke={`url(#${id}-arc)`} strokeOpacity="0.45" strokeWidth={TRACK_WIDTH} strokeLinecap="round" filter={`url(#${id}-glow)`} />
          <path
            d={arc}
            data-dial="move"
            fill="none"
            stroke={`url(#${id}-arc)`}
            strokeOpacity="0.78"
            strokeWidth={TRACK_WIDTH}
            strokeLinecap="round"
            className="cursor-grab active:cursor-grabbing"
            style={{ pointerEvents: "stroke" }}
          />
          <circle cx={CENTER} cy={CENTER} r={TRACK - TRACK_WIDTH / 2 - 10} fill="rgb(255 255 255 / 0.03)" stroke="rgb(255 255 255 / 0.08)" />
        </svg>
        {knob("open")}
        {knob("close")}
        <button
          type="button"
          data-dial="readout"
          aria-label="Type exact hours"
          onClick={() => exact.current?.focus()}
          className="absolute left-1/2 top-1/2 flex aspect-square w-[46%] -translate-x-1/2 -translate-y-1/2 flex-col items-center justify-center rounded-full text-center outline-none focus-visible:ring-2 focus-visible:ring-white/80"
        >
          <span aria-hidden="true" className="text-[3.6cqw] font-medium uppercase tracking-[0.14em] text-white/70">
            {full ? "Open" : "Hours"}
          </span>
          <span aria-hidden="true" className="mt-[1cqw] text-[7.2cqw] font-semibold leading-tight tabular-nums">
            {full ? "24 hours" : clockLabel(hours.open)}
          </span>
          {!full && (
            <>
              <span aria-hidden="true" className="text-[7.2cqw] font-semibold leading-tight tabular-nums">
                {clockLabel(hours.close)}
              </span>
              <span aria-hidden="true" className="mt-[1.5cqw] text-[3.8cqw] text-white/70 tabular-nums">
                {spanLabel(hours)}
              </span>
            </>
          )}
        </button>
      </div>
      <p className="sr-only" aria-live="polite">
        {full ? "Open 24 hours" : `${clockLabel(hours.open)} to ${clockLabel(hours.close)}, ${spanLabel(hours)}`}
      </p>
      <div role="group" aria-label="Common hours" className="mt-5 flex flex-wrap justify-center gap-2">
        {hourPresets.map((preset) => {
          const on = parsed?.open === preset.hours.open && parsed.close === preset.hours.close;
          return (
            <button
              key={preset.label}
              type="button"
              aria-pressed={on}
              onClick={() => emit(preset.hours)}
              className={`rounded-full border px-3 py-1.5 text-sm tabular-nums focus-visible:outline-2 focus-visible:outline-white ${on ? "border-white bg-white text-[#10131b]" : "border-white/30 text-white hover:bg-white/10"}`}
            >
              {preset.label}
            </button>
          );
        })}
      </div>
      <input
        ref={exact}
        aria-label="Hours, exact"
        aria-describedby={describedBy}
        autoComplete="off"
        maxLength={80}
        placeholder="9am – 5pm"
        value={value}
        onChange={(event) => onChange(event.target.value)}
        className="mx-auto mt-4 block w-full max-w-[16rem] border-b border-white/30 bg-transparent py-1 text-center text-base tabular-nums text-white placeholder:text-white/50 focus:border-white focus:outline-none"
      />
    </div>
  );
}

function SunIcon() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true" className="h-[55%] w-[55%]" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
      <circle cx="12" cy="12" r="4" fill="currentColor" />
      <path d="M12 2.5v2M12 19.5v2M2.5 12h2M19.5 12h2M5.3 5.3l1.4 1.4M17.3 17.3l1.4 1.4M5.3 18.7l1.4-1.4M17.3 6.7l1.4-1.4" />
    </svg>
  );
}

function MoonIcon() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true" className="h-[50%] w-[50%]" fill="currentColor">
      <path d="M20.5 14.3A8.5 8.5 0 0 1 9.7 3.5a8.5 8.5 0 1 0 10.8 10.8Z" />
    </svg>
  );
}
