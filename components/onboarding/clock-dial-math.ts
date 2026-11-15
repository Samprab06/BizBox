/**
 * HAC-154: the angle and time math behind the business-hours clock dial.
 *
 * Pure, so it is unit-tested without a browser. The dial is a 24-hour face: midnight at the
 * top, noon at the bottom, time running clockwise, one full turn per day. Times are minutes
 * after midnight. The value is stored in the existing intake `hours` field as a 24-hour
 * `HH:mm–HH:mm` range that `operatingHours()` (lib/client/intake-business-profile.ts) reads,
 * so it reaches `profileFromIntake` with no schema change.
 *
 * TODO(HAC-154): overnight hours (e.g. 6 PM – 2 AM). The BusinessProfile contract
 * (lib/contracts/index.ts `operatingHours`) requires closeMinute > openMinute within one
 * modeled day, so the dial clamps both handles to the same day: open in [0, close - 30],
 * close in [open + 30, 1440]. Once the contract can store a range that crosses midnight,
 * let the handles wrap here and in `moveHandle`.
 */
import { operatingHours } from "@/lib/client/intake-business-profile";

export const DAY = 1440;
export const STEP = 15;
export const MIN_SPAN = 30;
export const LABEL_EVERY_HOURS = 3;

export type HoursRange = { open: number; close: number };
export type Handle = "open" | "close";

export const DEFAULT_RANGE: HoursRange = { open: 9 * 60, close: 17 * 60 };

/** Quick choices under the dial. */
export const presets: readonly { label: string; range: HoursRange }[] = [
  { label: "9–5", range: { open: 540, close: 1020 } },
  { label: "7–3", range: { open: 420, close: 900 } },
  { label: "11–10", range: { open: 660, close: 1320 } },
  { label: "Open 24h", range: { open: 0, close: DAY } },
];

const clamp = (value: number, min: number, max: number) => Math.min(max, Math.max(min, value));

/** Degrees clockwise from the top (midnight) for a time. 1440 is the same angle as 0. */
export function minuteToAngle(minute: number): number {
  return (((minute / DAY) * 360) % 360 + 360) % 360;
}

/** The time at an angle (degrees clockwise from the top), in [0, 1440). */
export function angleToMinute(angle: number): number {
  const turn = ((angle % 360) + 360) % 360;
  return (turn / 360) * DAY;
}

/** Degrees clockwise from the top for a point relative to the dial's centre (screen coordinates, y down). */
export function pointToAngle(dx: number, dy: number): number {
  const degrees = (Math.atan2(dx, -dy) * 180) / Math.PI;
  return (degrees + 360) % 360;
}

/** A point on a circle of `radius` around (cx, cy) at a time, in screen coordinates. */
export function pointAt(minute: number, radius: number, cx = 0, cy = 0): { x: number; y: number } {
  const radians = (minuteToAngle(minute) * Math.PI) / 180;
  return { x: cx + Math.sin(radians) * radius, y: cy - Math.cos(radians) * radius };
}

/** Rounds to the nearest 15-minute step. */
export function snap(minute: number, step = STEP): number {
  return Math.round(minute / step) * step;
}

/** The limits a handle may take while the other one stays put. */
export function handleLimits(range: HoursRange, handle: Handle): { min: number; max: number } {
  return handle === "open" ? { min: 0, max: range.close - MIN_SPAN } : { min: range.open + MIN_SPAN, max: DAY };
}

/**
 * Moves one handle toward a dial time (e.g. from a pointer angle), snapped to 15 minutes.
 * The dial position is unwrapped to the turn nearest the handle's current time, so crossing
 * the top of the dial at midnight never jumps the handle to the other end of the day, and
 * the result is clamped so the handles never cross and keep a 30-minute span.
 */
export function moveHandle(range: HoursRange, handle: Handle, dialMinute: number): HoursRange {
  const current = range[handle];
  const candidates = [dialMinute - DAY, dialMinute, dialMinute + DAY];
  const nearest = candidates.reduce((best, value) => (Math.abs(value - current) < Math.abs(best - current) ? value : best));
  const { min, max } = handleLimits(range, handle);
  return { ...range, [handle]: clamp(snap(nearest), min, max) };
}

/**
 * Keyboard step: moves a handle by `steps` 15-minute steps. A value off the 15-minute grid
 * (typed exactly) first moves to the next grid line in that direction.
 */
export function stepHandle(range: HoursRange, handle: Handle, steps: number): HoursRange {
  const current = range[handle];
  const index = current / STEP;
  const base = steps > 0 ? Math.floor(index + 1e-9) : Math.ceil(index - 1e-9);
  const { min, max } = handleLimits(range, handle);
  return { ...range, [handle]: clamp((base + steps) * STEP, min, max) };
}

/** Home and End: the handle's lowest or highest allowed time. */
export function handleToLimit(range: HoursRange, handle: Handle, end: "min" | "max"): HoursRange {
  return { ...range, [handle]: handleLimits(range, handle)[end] };
}

/** Moves both handles together by a time difference, keeping the span and the same day. */
export function shiftRange(range: HoursRange, delta: number): HoursRange {
  const span = range.close - range.open;
  const open = clamp(snap(range.open + delta), 0, DAY - span);
  return { open, close: open + span };
}

/** The signed shortest difference between two dial times, in (-720, 720]. */
export function dialDelta(from: number, to: number): number {
  let delta = (to - from) % DAY;
  if (delta > DAY / 2) delta -= DAY;
  if (delta <= -DAY / 2) delta += DAY;
  return delta;
}

/** "9:00 AM". Both 0 and 1440 read as 12:00 AM (midnight). */
export function formatTime(minute: number): string {
  const inDay = ((minute % DAY) + DAY) % DAY;
  const hour = Math.floor(inDay / 60);
  const minutes = inDay % 60;
  const twelve = hour % 12 === 0 ? 12 : hour % 12;
  return `${twelve}:${String(minutes).padStart(2, "0")} ${hour < 12 ? "AM" : "PM"}`;
}

/** "8 hrs", "8 hrs 15 min", "30 min", "1 hr". */
export function formatSpan(range: HoursRange): string {
  const total = range.close - range.open;
  const hours = Math.floor(total / 60);
  const minutes = total % 60;
  const hourText = hours ? `${hours} ${hours === 1 ? "hr" : "hrs"}` : "";
  const minuteText = minutes ? `${minutes} min` : "";
  return [hourText, minuteText].filter(Boolean).join(" ") || "0 min";
}

/** The hour label on the dial face, e.g. "12a", "3p". */
export function hourLabel(hour: number): string {
  const h = ((hour % 24) + 24) % 24;
  return `${h % 12 === 0 ? 12 : h % 12}${h < 12 ? "a" : "p"}`;
}

/** The labelled hours, every 3 hours: 0, 3, …, 21. */
export const labelHours: readonly number[] = Array.from({ length: 24 / LABEL_EVERY_HOURS }, (_, i) => i * LABEL_EVERY_HOURS);

const hhmm = (minute: number) => `${String(Math.floor(minute / 60)).padStart(2, "0")}:${String(minute % 60).padStart(2, "0")}`;

/** The intake `hours` text for a range, e.g. "09:00–17:00" (close at midnight is "24:00"). */
export function formatHoursValue(range: HoursRange): string {
  return `${hhmm(range.open)}–${hhmm(range.close)}`;
}

/** The range in a saved intake `hours` answer, or null when it is not one same-day range. */
export function parseHoursValue(text: string): HoursRange | null {
  const hours = operatingHours(text);
  return hours && hours.closeMinute - hours.openMinute >= MIN_SPAN ? { open: hours.openMinute, close: hours.closeMinute } : null;
}

/**
 * One typed time, e.g. "9", "9:30", "9:30 pm", "930p", "17:45", "noon", "midnight".
 * Without AM/PM the hour is read on a 24-hour clock. "midnight" and "24:00" are 1440 for
 * a closing time and 0 for an opening time.
 */
export function parseTime(text: string, handle: Handle): number | null {
  const value = text.trim().toLowerCase().replace(/\./g, "");
  if (value === "noon") return 720;
  if (value === "midnight") return handle === "close" ? DAY : 0;
  const match = /^(\d{1,2})(?::?(\d{2}))?\s*(a|am|p|pm)?$/.exec(value);
  if (!match) return null;
  const hour = Number(match[1]);
  const minutes = Number(match[2] ?? 0);
  const period = match[3]?.[0];
  if (minutes > 59) return null;
  let minute: number;
  if (period) {
    if (hour < 1 || hour > 12) return null;
    minute = ((hour % 12) + (period === "p" ? 12 : 0)) * 60 + minutes;
  } else {
    if (hour > 24 || (hour === 24 && minutes > 0)) return null;
    minute = hour * 60 + minutes;
  }
  if (handle === "close" && minute === 0) return DAY;
  if (handle === "open" && minute === DAY) return 0;
  return minute;
}

/** The error to show for a typed range, or undefined when it is valid. */
export function typedRangeError(range: { open: number | null; close: number | null }): string | undefined {
  if (range.open === null || range.close === null) return "Use a time like 9:30 AM or 17:30.";
  // TODO(HAC-154): allow overnight ranges once the profile contract can store them.
  if (range.close <= range.open) return "Closing must be after opening on the same day.";
  if (range.close - range.open < MIN_SPAN) return "Stay open at least 30 minutes.";
}

/** An SVG arc path along the dial from open to close, clockwise. */
export function arcPath(range: HoursRange, radius: number, cx: number, cy: number): string {
  const span = range.close - range.open;
  if (span >= DAY) {
    // A full day is two half arcs: one SVG arc cannot start and end at the same point.
    const top = pointAt(0, radius, cx, cy);
    const bottom = pointAt(DAY / 2, radius, cx, cy);
    return `M ${top.x} ${top.y} A ${radius} ${radius} 0 1 1 ${bottom.x} ${bottom.y} A ${radius} ${radius} 0 1 1 ${top.x} ${top.y}`;
  }
  const start = pointAt(range.open, radius, cx, cy);
  const end = pointAt(range.close, radius, cx, cy);
  const large = span > DAY / 2 ? 1 : 0;
  return `M ${start.x} ${start.y} A ${radius} ${radius} 0 ${large} 1 ${end.x} ${end.y}`;
}
