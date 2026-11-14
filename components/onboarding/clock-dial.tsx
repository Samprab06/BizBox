"use client";

import { useRef, useState, type FocusEvent, type KeyboardEvent, type PointerEvent } from "react";
import {
  DAY,
  STEP,
  angleToMinute,
  arcPath,
  dialDelta,
  formatSpan,
  formatTime,
  handleLimits,
  handleToLimit,
  hourLabel,
  labelHours,
  moveHandle,
  parseTime,
  pointAt,
  pointToAngle,
  presets,
  shiftRange,
  stepHandle,
  typedRangeError,
  type Handle,
  type HoursRange,
} from "./clock-dial-math";
import styles from "./clock-dial.module.css";

// The SVG is drawn in a 320×320 box and scales with the dial's width.
const SIZE = 320;
const C = SIZE / 2;
const ARC_R = 100;
const LABEL_R = 130;
const TICK_OUTER = 152;

const names: Record<Handle, { short: string; label: string; verb: string }> = {
  open: { short: "Open", label: "Opening time", verb: "Opens" },
  close: { short: "Close", label: "Closing time", verb: "Closes" },
};

type Drag = { id: number; target: Handle | "arc"; startMinute: number; startRange: HoursRange };

/**
 * HAC-154: the business-hours question as a flat 24-hour glass clock dial. Midnight is at
 * the top and one turn is one day. Two `role="slider"` handles set the opening and closing
 * time (pointer drag snaps to 15 minutes; arrows step 15 minutes, Shift+arrows 1 hour,
 * Home/End jump to the limits). The arc between them drags both together. The centre
 * readout opens exact typed entry. The parent owns the value; this only reports changes.
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
  const face = useRef<HTMLDivElement>(null);
  const openInput = useRef<HTMLInputElement>(null);
  const [drag, setDrag] = useState<Drag | null>(null);
  const [typed, setTyped] = useState<{ open: string; close: string } | null>(null);
  const [typedError, setTypedError] = useState<string | undefined>();

  const emit = (next: HoursRange) => {
    if (next.open !== value.open || next.close !== value.close) onChange(next);
  };

  function dialMinute(event: PointerEvent): number {
    const box = face.current!.getBoundingClientRect();
    return angleToMinute(pointToAngle(event.clientX - (box.left + box.width / 2), event.clientY - (box.top + box.height / 2)));
  }

  function startDrag(target: Handle | "arc", event: PointerEvent<HTMLElement | SVGElement>) {
    if (!event.isPrimary || (event.pointerType === "mouse" && event.button !== 0)) return;
    event.preventDefault();
    event.currentTarget.setPointerCapture(event.pointerId);
    if (target !== "arc") (event.currentTarget as HTMLElement).focus({ preventScroll: true });
    setDrag({ id: event.pointerId, target, startMinute: dialMinute(event), startRange: value });
  }

  function moveDrag(event: PointerEvent) {
    if (!drag || drag.id !== event.pointerId) return;
    const minute = dialMinute(event);
    if (drag.target === "arc") emit(shiftRange(drag.startRange, dialDelta(drag.startMinute, minute)));
    else emit(moveHandle(value, drag.target, minute));
  }

  function endDrag(event: PointerEvent<HTMLElement | SVGElement>) {
    if (!drag || drag.id !== event.pointerId) return;
    if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId);
    setDrag(null);
  }

  function onHandleKey(handle: Handle, event: KeyboardEvent<HTMLDivElement>) {
    const hour = event.shiftKey ? 60 / STEP : 1;
    const steps: Record<string, number> = {
      ArrowRight: hour,
      ArrowUp: hour,
      ArrowLeft: -hour,
      ArrowDown: -hour,
      PageUp: 60 / STEP,
      PageDown: -60 / STEP,
    };
    let next: HoursRange | undefined;
    if (event.key === "Home") next = handleToLimit(value, handle, "min");
    else if (event.key === "End") next = handleToLimit(value, handle, "max");
    else if (steps[event.key] !== undefined) next = stepHandle(value, handle, steps[event.key]!);
    if (!next) return;
    event.preventDefault();
    emit(next);
  }

  function openTyped() {
    setTypedError(undefined);
    setTyped({ open: formatTime(value.open), close: formatTime(value.close) });
    requestAnimationFrame(() => openInput.current?.select());
  }

  /** Applies the typed times; returns false and shows why when they are not a valid range. */
  function applyTyped(): boolean {
    if (!typed) return true;
    const range = { open: parseTime(typed.open, "open"), close: parseTime(typed.close, "close") };
    const message = typedRangeError(range);
    if (message) {
      setTypedError(message);
      return false;
    }
    emit({ open: range.open!, close: range.close! });
    setTyped(null);
    setTypedError(undefined);
    return true;
  }

  function onTypedKey(event: KeyboardEvent<HTMLInputElement>) {
    if (event.key === "Enter") {
      // Enter applies the typed times instead of submitting the question.
      event.preventDefault();
      applyTyped();
    } else if (event.key === "Escape") {
      event.preventDefault();
      setTyped(null);
      setTypedError(undefined);
    }
  }

  function onTypedBlur(event: FocusEvent<HTMLDivElement>) {
    if (!event.currentTarget.contains(event.relatedTarget as Node | null)) applyTyped();
  }

  const spanText = formatSpan(value);
  const ticks = Array.from({ length: DAY / STEP }, (_, i) => i * STEP);
  const hit = arcPath(value, ARC_R, C, C);

  return (
    <div className="flex flex-col items-center">
      <div ref={face} role="group" aria-labelledby={labelledBy} className={`${styles.face} w-full max-w-[22rem] backdrop-blur-[12px]`} data-testid="clock-dial">
        <svg viewBox={`0 0 ${SIZE} ${SIZE}`} className="absolute inset-0 h-full w-full" aria-hidden="true">
          {ticks.map((minute) => {
            const hourTick = minute % 60 === 0;
            const major = minute % 180 === 0;
            const inner = TICK_OUTER - (major ? 10 : hourTick ? 7 : 3);
            const a = pointAt(minute, TICK_OUTER, C, C);
            const b = pointAt(minute, inner, C, C);
            return (
              <line
                key={minute}
                x1={a.x}
                y1={a.y}
                x2={b.x}
                y2={b.y}
                stroke="#f7f7fa"
                strokeOpacity={major ? 0.8 : hourTick ? 0.45 : 0.16}
                strokeWidth={hourTick ? 1.5 : 1}
                strokeLinecap="round"
              />
            );
          })}
          {labelHours.map((hour) => {
            const p = pointAt(hour * 60, LABEL_R, C, C);
            return (
              <text key={hour} x={p.x} y={p.y} textAnchor="middle" dominantBaseline="central" className={styles.label}>
                {hourLabel(hour)}
              </text>
            );
          })}
          <circle cx={C} cy={C} r={ARC_R} fill="none" stroke="#f7f7fa" strokeOpacity={0.1} strokeWidth={12} />
          <path d={hit} fill="none" stroke="#f3f3f6" strokeOpacity={drag ? 0.22 : 0.14} strokeWidth={26} strokeLinecap="round" className={styles.glow} />
          <path d={hit} fill="none" stroke="#f3f3f6" strokeOpacity={0.55} strokeWidth={12} strokeLinecap="round" data-testid="clock-arc" />
        </svg>
        {/* The arc's drag target sits above the drawing but under the handles. */}
        <svg viewBox={`0 0 ${SIZE} ${SIZE}`} className="pointer-events-none absolute inset-0 h-full w-full" aria-hidden="true">
          <path
            d={hit}
            fill="none"
            stroke="transparent"
            strokeWidth={30}
            className={`${styles.arcHit} pointer-events-auto`}
            data-testid="clock-arc-hit"
            onPointerDown={(event) => startDrag("arc", event)}
            onPointerMove={moveDrag}
            onPointerUp={endDrag}
            onPointerCancel={endDrag}
          />
        </svg>

        {(["open", "close"] as const).map((handle) => {
          const p = pointAt(value[handle], ARC_R, C, C);
          const limits = handleLimits(value, handle);
          return (
            <div
              key={handle}
              role="slider"
              tabIndex={0}
              aria-label={names[handle].label}
              aria-describedby={describedBy}
              aria-valuemin={limits.min}
              aria-valuemax={limits.max}
              aria-valuenow={value[handle]}
              aria-valuetext={`${names[handle].verb} at ${formatTime(value[handle])}`}
              data-dragging={drag?.target === handle}
              className={styles.handle}
              style={{ left: `${(p.x / SIZE) * 100}%`, top: `${(p.y / SIZE) * 100}%` }}
              onKeyDown={(event) => onHandleKey(handle, event)}
              onPointerDown={(event) => startDrag(handle, event)}
              onPointerMove={moveDrag}
              onPointerUp={endDrag}
              onPointerCancel={endDrag}
            >
              <span aria-hidden="true">{names[handle].short}</span>
            </div>
          );
        })}

        <div className="absolute left-1/2 top-1/2 flex w-[52%] -translate-x-1/2 -translate-y-1/2 flex-col items-center text-center">
          {typed ? (
            <div className="flex w-full flex-col items-stretch gap-1.5" onBlur={onTypedBlur}>
              {(["open", "close"] as const).map((handle) => (
                <label key={handle} className="flex items-center justify-between gap-2 text-xs text-white/80">
                  {names[handle].verb}
                  <input
                    ref={handle === "open" ? openInput : undefined}
                    value={typed[handle]}
                    onChange={(event) => {
                      setTypedError(undefined);
                      setTyped({ ...typed, [handle]: event.target.value });
                    }}
                    onKeyDown={onTypedKey}
                    aria-invalid={typedError ? true : undefined}
                    aria-describedby={typedError ? "clock-dial-error" : undefined}
                    autoComplete="off"
                    maxLength={12}
                    className="w-[6.5rem] min-w-0 rounded-lg border border-white/30 bg-white/10 px-2 py-1 text-sm tabular-nums text-white focus:border-white focus:outline-none"
                  />
                </label>
              ))}
              <button type="button" onClick={applyTyped} className="mt-0.5 self-center rounded-full bg-white px-3 py-1 text-xs font-semibold text-[#10131b] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-white">
                Set hours
              </button>
            </div>
          ) : (
            <button type="button" onClick={openTyped} className="rounded-2xl px-2 py-1 focus-visible:outline-2 focus-visible:outline-white" data-testid="clock-readout">
              <span className="block text-lg font-semibold leading-tight tabular-nums sm:text-xl">
                {formatTime(value.open)} –<br />
                {formatTime(value.close)}
              </span>
              <span className="mt-1 block text-sm text-white/80">{spanText}</span>
              <span className="mt-1 block text-[10px] uppercase tracking-wide text-white/60">Type exact times</span>
            </button>
          )}
        </div>
      </div>
      {typedError && (
        <p id="clock-dial-error" role="alert" className="mt-3 text-sm font-medium text-amber-200">
          {typedError}
        </p>
      )}
      <div role="group" aria-label="Common hours" className="mt-4 flex flex-wrap justify-center gap-2">
        {presets.map((preset) => {
          const on = preset.range.open === value.open && preset.range.close === value.close;
          return (
            <button
              key={preset.label}
              type="button"
              aria-pressed={on}
              onClick={() => {
                setTyped(null);
                setTypedError(undefined);
                emit(preset.range);
              }}
              className={`rounded-full border px-3 py-1.5 text-sm focus-visible:outline-2 focus-visible:outline-white ${on ? "border-white bg-white text-[#10131b]" : "border-white/30 text-white hover:bg-white/10"}`}
            >
              {preset.label}
            </button>
          );
        })}
      </div>
    </div>
  );
}
