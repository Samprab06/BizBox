import { describe, expect, it } from "vitest";
import { profileFromIntake } from "@/lib/client/intake-business-profile";
import { patchFromForm } from "@/components/intake/live";
import type { Profile } from "@/components/intake/profile";
import {
  DAY,
  DEFAULT_RANGE,
  angleToMinute,
  arcPath,
  dialDelta,
  formatHoursValue,
  formatSpan,
  formatTime,
  handleToLimit,
  hourLabel,
  labelHours,
  minuteToAngle,
  moveHandle,
  parseHoursValue,
  parseTime,
  pointAt,
  pointToAngle,
  shiftRange,
  snap,
  stepHandle,
  typedRangeError,
  rubberBand,
  settle,
  turnBetween,
  wheelAngle,
  wheelLabelStyle,
} from "./clock-dial-math";

describe("dial angles", () => {
  it("puts midnight at the top, 6 AM right, noon bottom and 6 PM left", () => {
    expect(minuteToAngle(0)).toBe(0);
    expect(minuteToAngle(360)).toBe(90);
    expect(minuteToAngle(720)).toBe(180);
    expect(minuteToAngle(1080)).toBe(270);
    expect(minuteToAngle(DAY)).toBe(0);
    expect(angleToMinute(90)).toBe(360);
    expect(angleToMinute(-90)).toBe(1080);
    expect(angleToMinute(450)).toBe(360);
  });

  it("reads pointer angles in screen coordinates (y grows downward)", () => {
    expect(pointToAngle(0, -10)).toBe(0);
    expect(pointToAngle(10, 0)).toBe(90);
    expect(pointToAngle(0, 10)).toBe(180);
    expect(pointToAngle(-10, 0)).toBe(270);
  });

  it("round-trips a time through a point and its angle", () => {
    for (const minute of [0, 135, 540, 1020, 1395]) {
      const point = pointAt(minute, 100);
      expect(angleToMinute(pointToAngle(point.x, point.y))).toBeCloseTo(minute, 6);
    }
  });

  it("labels every 3 hours, evenly spaced", () => {
    expect(labelHours.map(hourLabel)).toEqual(["12a", "3a", "6a", "9a", "12p", "3p", "6p", "9p"]);
    const angles = labelHours.map((hour) => minuteToAngle(hour * 60));
    angles.forEach((angle, i) => expect(angle).toBe(i * 45));
  });
});

describe("handles", () => {
  it("snaps to 15 minutes", () => {
    expect(snap(547)).toBe(540);
    expect(snap(548)).toBe(555);
  });

  it("moves a handle to the snapped pointer time", () => {
    expect(moveHandle(DEFAULT_RANGE, "open", 487)).toEqual({ open: 480, close: 1020 });
    expect(moveHandle(DEFAULT_RANGE, "close", 1103)).toEqual({ open: 540, close: 1110 });
  });

  it("can't cross the other handle and keeps a 30-minute span", () => {
    expect(moveHandle(DEFAULT_RANGE, "open", 1100)).toEqual({ open: 990, close: 1020 });
    expect(moveHandle(DEFAULT_RANGE, "close", 300)).toEqual({ open: 540, close: 570 });
  });

  it("clamps at midnight instead of jumping to the other end of the day", () => {
    // Closing at 11:45 PM and dragged just past the top reads as midnight, not 12:15 AM.
    expect(moveHandle({ open: 540, close: 1425 }, "close", 15)).toEqual({ open: 540, close: DAY });
    // Opening at 12:15 AM and dragged just before the top stays at 12:00 AM.
    expect(moveHandle({ open: 15, close: 1020 }, "open", 1425)).toEqual({ open: 0, close: 1020 });
  });

  it("steps by 15 minutes or 1 hour, within limits", () => {
    expect(stepHandle(DEFAULT_RANGE, "open", 1)).toEqual({ open: 555, close: 1020 });
    expect(stepHandle(DEFAULT_RANGE, "close", -4)).toEqual({ open: 540, close: 960 });
    expect(stepHandle({ open: 990, close: 1020 }, "open", 1)).toEqual({ open: 990, close: 1020 });
    expect(stepHandle({ open: 0, close: 1020 }, "open", -4)).toEqual({ open: 0, close: 1020 });
    // An exact off-grid time moves to the next grid line in that direction.
    expect(stepHandle({ open: 548, close: 1020 }, "open", 1)).toEqual({ open: 555, close: 1020 });
    expect(stepHandle({ open: 548, close: 1020 }, "open", -1)).toEqual({ open: 540, close: 1020 });
  });

  it("jumps to the limits with Home and End", () => {
    expect(handleToLimit(DEFAULT_RANGE, "open", "min")).toEqual({ open: 0, close: 1020 });
    expect(handleToLimit(DEFAULT_RANGE, "open", "max")).toEqual({ open: 990, close: 1020 });
    expect(handleToLimit(DEFAULT_RANGE, "close", "min")).toEqual({ open: 540, close: 570 });
    expect(handleToLimit(DEFAULT_RANGE, "close", "max")).toEqual({ open: 540, close: DAY });
  });

  it("shifts both handles together, keeping the span within the day", () => {
    expect(shiftRange(DEFAULT_RANGE, 62)).toEqual({ open: 600, close: 1080 });
    expect(shiftRange(DEFAULT_RANGE, 1000)).toEqual({ open: 960, close: DAY });
    expect(shiftRange(DEFAULT_RANGE, -1000)).toEqual({ open: 0, close: 480 });
    expect(dialDelta(1430, 10)).toBe(20);
    expect(dialDelta(10, 1430)).toBe(-20);
  });
});

describe("text", () => {
  it("formats the readout", () => {
    expect(formatTime(540)).toBe("9:00 AM");
    expect(formatTime(1020)).toBe("5:00 PM");
    expect(formatTime(0)).toBe("12:00 AM");
    expect(formatTime(720)).toBe("12:00 PM");
    expect(formatTime(DAY)).toBe("12:00 AM");
    expect(formatSpan(DEFAULT_RANGE)).toBe("8 hrs");
    expect(formatSpan({ open: 540, close: 615 })).toBe("1 hr 15 min");
    expect(formatSpan({ open: 540, close: 570 })).toBe("30 min");
  });

  it("parses typed times", () => {
    expect(parseTime("9", "open")).toBe(540);
    expect(parseTime("9:30 pm", "close")).toBe(1290);
    expect(parseTime("930p", "close")).toBe(1290);
    expect(parseTime("9:30 A.M.", "open")).toBe(570);
    expect(parseTime("17:45", "close")).toBe(1065);
    expect(parseTime("noon", "open")).toBe(720);
    expect(parseTime("12 am", "open")).toBe(0);
    expect(parseTime("12am", "close")).toBe(DAY);
    expect(parseTime("midnight", "close")).toBe(DAY);
    expect(parseTime("24:00", "close")).toBe(DAY);
    expect(parseTime("13pm", "open")).toBeNull();
    expect(parseTime("9:75", "open")).toBeNull();
    expect(parseTime("evening", "open")).toBeNull();
  });

  it("explains invalid typed ranges", () => {
    expect(typedRangeError({ open: 540, close: 1020 })).toBeUndefined();
    expect(typedRangeError({ open: null, close: 1020 })).toMatch(/9:30 AM/);
    expect(typedRangeError({ open: 1080, close: 120 })).toMatch(/same day/);
    expect(typedRangeError({ open: 540, close: 555 })).toMatch(/30 minutes/);
  });
});

describe("intake value", () => {
  it("stores 24-hour HH:mm text that round-trips", () => {
    expect(formatHoursValue(DEFAULT_RANGE)).toBe("09:00–17:00");
    expect(formatHoursValue({ open: 0, close: DAY })).toBe("00:00–24:00");
    expect(parseHoursValue("09:00–17:00")).toEqual(DEFAULT_RANGE);
    expect(parseHoursValue("00:00–24:00")).toEqual({ open: 0, close: DAY });
    expect(parseHoursValue("11am – 11pm")).toEqual({ open: 660, close: 1380 });
    expect(parseHoursValue("evenings")).toBeNull();
  });

  it("reaches profileFromIntake as operating hours", () => {
    const founder = (value: string) => ({ value, origin: "founder" as const });
    const profile: Profile = {
      concept: founder("Neighborhood coffee"),
      category: founder("Coffee shop"),
      city: founder("Houston"),
      areas: founder("No preference"),
      rent: founder("4500"),
      buildout: founder("80000"),
      price: founder("Midrange"),
      customers: founder("Commuters"),
      hours: founder(formatHoursValue({ open: 420, close: 1290 })),
      staff: founder("2"),
      requirements: founder("None"),
    };
    const result = profileFromIntake({ profile, messages: [] }, "houston-coffee");
    expect(result.profile?.operatingHours).toEqual({ openMinute: 420, closeMinute: 1290 });
    // Open 24h is the whole modeled day.
    const allDay = profileFromIntake({ profile: { ...profile, hours: founder("00:00–24:00") }, messages: [] }, "houston-coffee");
    expect(allDay.profile?.operatingHours).toEqual({ openMinute: 0, closeMinute: DAY });
    // The live intake API gets the same minutes as a founder patch.
    expect(patchFromForm(profile, ["hours"])).toEqual({ operatingHours: { openMinute: 420, closeMinute: 1290 } });
  });

  it("draws the open arc clockwise, with the large-arc flag past 12 hours", () => {
    expect(arcPath(DEFAULT_RANGE, 100, 0, 0)).toContain(" 0 0 1 ");
    expect(arcPath({ open: 300, close: 1200 }, 100, 0, 0)).toContain(" 0 1 1 ");
    expect(arcPath({ open: 0, close: DAY }, 100, 0, 0).match(/A /g)).toHaveLength(2);
  });
});

describe("rotating wheel (HAC-160)", () => {
  it("places times relative to the marker at the top, wrapping around the day", () => {
    expect(wheelAngle(540, 540)).toBe(0);
    expect(wheelAngle(600, 540)).toBe(15);
    expect(wheelAngle(480, 540)).toBe(-15);
    expect(wheelAngle(0, 1380)).toBe(15);
    expect(wheelAngle(1380, 0)).toBe(-15);
    expect(wheelAngle(1260, 540)).toBe(180);
  });

  it("makes labels largest and brightest at the marker and gone at the horizon", () => {
    const centre = wheelLabelStyle(0);
    const near = wheelLabelStyle(15);
    const edge = wheelLabelStyle(90);
    expect(centre.scale).toBeGreaterThan(near.scale);
    expect(near.scale).toBeGreaterThan(edge.scale);
    expect(centre.opacity).toBeGreaterThan(near.opacity);
    expect(edge.opacity).toBe(0);
    expect(wheelLabelStyle(-15)).toEqual(near);
  });

  it("measures pointer turns the short way round", () => {
    expect(turnBetween(350, 10)).toBe(20);
    expect(turnBetween(10, 350)).toBe(-20);
    expect(turnBetween(90, 270)).toBe(180);
  });

  it("gives way past a limit and settles on 15 minutes inside it", () => {
    expect(rubberBand(500, 540, 990)).toBe(528);
    expect(rubberBand(1100, 540, 990)).toBe(1023);
    expect(rubberBand(700, 540, 990)).toBe(700);
    expect(settle(707, 0, 990)).toBe(705);
    expect(settle(1100, 0, 990)).toBe(990);
    expect(settle(-40, 0, 990)).toBe(0);
  });
});
