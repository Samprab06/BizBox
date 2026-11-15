/**
 * HAC-154: pure helpers for the business-hours clock dial.
 *
 * The dial shows one day (24 hours) per turn, midnight at the top and noon at the bottom.
 * Hours are stored as the same intake text the map already reads (operatingHours), so the
 * dial adds no field or store: it only converts between minutes and that text. Ranges stay
 * within one day, because operatingHours rejects overnight ranges.
 */
import { operatingHours } from "@/lib/client/intake-business-profile";

export const DAY = 1440;
export const STEP = 15;
export const MIN_SPAN = 30;

export type Hours = { open: number; close: number };

export const defaultHours: Hours = { open: 9 * 60, close: 17 * 60 };

/** Quick picks under the dial. */
export const hourPresets = [
  { label: "9–5", hours: { open: 9 * 60, close: 17 * 60 } },
  { label: "7–3", hours: { open: 7 * 60, close: 15 * 60 } },
  { label: "11–10", hours: { open: 11 * 60, close: 22 * 60 } },
  { label: "Open 24h", hours: { open: 0, close: DAY } },
] as const satisfies readonly { label: string; hours: Hours }[];

const pad = (value: number) => String(value).padStart(2, "0");

/** 12-hour text for one minute of the day, e.g. 540 → "9:00 AM"; 1440 → "12:00 AM". */
export function clockLabel(minute: number): string {
  const hour = Math.floor(minute / 60) % 24;
  const period = hour < 12 ? "AM" : "PM";
  return `${hour % 12 || 12}:${pad(minute % 60)} ${period}`;
}

/** Compact 12-hour text the intake already uses, e.g. "9am", "9:30pm". */
function short(minute: number): string {
  const hour = Math.floor(minute / 60) % 24;
  const mins = minute % 60;
  return `${hour % 12 || 12}${mins ? `:${pad(mins)}` : ""}${hour < 12 ? "am" : "pm"}`;
}

/**
 * The intake text for a range, e.g. "9am – 5pm". A close at midnight is written in
 * 24-hour form ("00:00 – 24:00"), the only way operatingHours reads an end-of-day close.
 */
export function formatHours({ open, close }: Hours): string {
  if (close === DAY) return `${pad(Math.floor(open / 60))}:${pad(open % 60)} – 24:00`;
  return `${short(open)} – ${short(close)}`;
}

/** The range in intake text, or null when it is not one same-day range. */
export function parseHours(text: string): Hours | null {
  const hours = operatingHours(text);
  return hours ? { open: hours.openMinute, close: hours.closeMinute } : null;
}

/** "8 hrs", "8 hrs 30 min", "24 hrs". */
export function spanLabel({ open, close }: Hours): string {
  const minutes = close - open;
  const hours = Math.floor(minutes / 60);
  const rest = minutes % 60;
  if (!hours) return `${rest} min`;
  return `${hours} ${hours === 1 ? "hr" : "hrs"}${rest ? ` ${rest} min` : ""}`;
}

/** Review text, e.g. "9:00 AM – 5:00 PM", or the saved text when it cannot be read. */
export function hoursReview(text: string): string {
  const hours = parseHours(text);
  if (!hours) return text;
  if (hours.open === 0 && hours.close === DAY) return "Open 24 hours";
  return `${clockLabel(hours.open)} – ${clockLabel(hours.close)}`;
}

/** Degrees clockwise from the top of the dial for a minute of the day. */
export const angleOf = (minute: number) => (minute / DAY) * 360;

/** A point on the dial, in a square of side `size`, at `radius` from the centre. */
export function pointAt(minute: number, radius: number, size: number) {
  const radians = (angleOf(minute) * Math.PI) / 180;
  return { x: size / 2 + Math.sin(radians) * radius, y: size / 2 - Math.cos(radians) * radius };
}

/** The minute of the day under a pointer offset (dx right, dy down) from the dial centre, snapped. */
export function minuteAt(dx: number, dy: number): number {
  const degrees = (Math.atan2(dx, -dy) * 180) / Math.PI;
  const minute = (((degrees + 360) % 360) / 360) * DAY;
  return (Math.round(minute / STEP) * STEP) % DAY;
}

/**
 * Picks the reading of a dial minute nearest to `previous`, so dragging across midnight
 * at the top runs into the end of the day instead of jumping to the other side.
 */
export function unwrap(minute: number, previous: number): number {
  return [minute - DAY, minute, minute + DAY].reduce((best, candidate) =>
    Math.abs(candidate - previous) < Math.abs(best - previous) ? candidate : best,
  );
}

const clamp = (value: number, min: number, max: number) => Math.min(max, Math.max(min, value));

/** Moves one end, keeping the range inside one day and at least MIN_SPAN long. */
export function moveEnd(hours: Hours, end: "open" | "close", minute: number): Hours {
  return end === "open"
    ? { ...hours, open: clamp(minute, 0, hours.close - MIN_SPAN) }
    : { ...hours, close: clamp(minute, hours.open + MIN_SPAN, DAY) };
}

/** Shifts the whole range by `delta` minutes, keeping its length and staying inside the day. */
export function shiftRange(hours: Hours, delta: number): Hours {
  const span = hours.close - hours.open;
  const open = clamp(hours.open + delta, 0, DAY - span);
  return { open, close: open + span };
}

/** Which end a tap on the dial should move: the nearer one along the clock. */
export function nearestEnd(hours: Hours, minute: number): "open" | "close" {
  const distance = (a: number, b: number) => {
    const raw = Math.abs(a - b) % DAY;
    return Math.min(raw, DAY - raw);
  };
  return distance(minute, hours.open) <= distance(minute, hours.close) ? "open" : "close";
}

/** Hour labels around the edge: every three hours. */
export const dialLabels = [0, 3, 6, 9, 12, 15, 18, 21].map((hour) => ({
  minute: hour * 60,
  text: hour === 0 ? "12a" : hour === 12 ? "12p" : `${hour % 12}${hour < 12 ? "a" : "p"}`,
}));
