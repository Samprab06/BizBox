import { describe, expect, it } from "vitest";
import { operatingHours } from "@/lib/client/intake-business-profile";
import { reviewValue, stepError } from "./flow";
import {
  DAY,
  clockLabel,
  defaultHours,
  dialLabels,
  formatHours,
  hourPresets,
  hoursReview,
  minuteAt,
  moveEnd,
  nearestEnd,
  parseHours,
  pointAt,
  shiftRange,
  spanLabel,
  unwrap,
} from "./hours";

describe("hours text", () => {
  it("defaults to 9am – 5pm, written the way intake already stores hours", () => {
    expect(defaultHours).toEqual({ open: 540, close: 1020 });
    expect(formatHours(defaultHours)).toBe("9am – 5pm");
    expect(formatHours({ open: 570, close: 1335 })).toBe("9:30am – 10:15pm");
    expect(formatHours({ open: 0, close: 720 })).toBe("12am – 12pm");
  });

  it("writes every range the dial can make as text the map reads back exactly", () => {
    for (let open = 0; open < DAY; open += 15)
      for (const close of [open + 30, open + 255, DAY])
        if (close <= DAY) {
          const text = formatHours({ open, close });
          expect(operatingHours(text), text).toEqual({ openMinute: open, closeMinute: close });
          expect(stepError("hours", text), text).toBeUndefined();
        }
  });

  it("writes a midnight close in 24-hour form, the only end-of-day close the map accepts", () => {
    expect(formatHours({ open: 0, close: DAY })).toBe("00:00 – 24:00");
    expect(formatHours({ open: 1080, close: DAY })).toBe("18:00 – 24:00");
    expect(parseHours("18:00 – 24:00")).toEqual({ open: 1080, close: DAY });
  });

  it("reads typed ranges and rejects anything that is not one same-day range", () => {
    expect(parseHours("11am – 11pm")).toEqual({ open: 660, close: 1380 });
    expect(parseHours("07:00–17:00")).toEqual({ open: 420, close: 1020 });
    expect(parseHours("evenings")).toBeNull();
    expect(parseHours("10pm – 2am")).toBeNull();
  });

  it("labels times, spans and the review", () => {
    expect(clockLabel(540)).toBe("9:00 AM");
    expect(clockLabel(0)).toBe("12:00 AM");
    expect(clockLabel(735)).toBe("12:15 PM");
    expect(spanLabel(defaultHours)).toBe("8 hrs");
    expect(spanLabel({ open: 540, close: 1050 })).toBe("8 hrs 30 min");
    expect(spanLabel({ open: 540, close: 600 })).toBe("1 hr");
    expect(spanLabel({ open: 540, close: 570 })).toBe("30 min");
    expect(hoursReview("9am – 5pm")).toBe("9:00 AM – 5:00 PM");
    expect(hoursReview("00:00 – 24:00")).toBe("Open 24 hours");
    expect(hoursReview("whenever")).toBe("whenever");
    expect(reviewValue("hours", "11am – 11pm")).toBe("11:00 AM – 11:00 PM");
  });

  it("offers presets the map can read", () => {
    for (const preset of hourPresets) expect(stepError("hours", formatHours(preset.hours))).toBeUndefined();
  });
});

describe("dial geometry", () => {
  it("puts midnight at the top, 6am right, noon at the bottom and 6pm left", () => {
    const at = (minute: number) => {
      const point = pointAt(minute, 100, 200);
      return [Math.round(point.x), Math.round(point.y)];
    };
    expect(at(0)).toEqual([100, 0]);
    expect(at(360)).toEqual([200, 100]);
    expect(at(720)).toEqual([100, 200]);
    expect(at(1080)).toEqual([0, 100]);
  });

  it("reads a pointer offset back to a minute snapped to 15", () => {
    expect(minuteAt(0, -10)).toBe(0);
    expect(minuteAt(10, 0)).toBe(360);
    expect(minuteAt(0, 10)).toBe(720);
    expect(minuteAt(-10, 0)).toBe(1080);
    const nine = pointAt(547, 100, 200);
    expect(minuteAt(nine.x - 100, nine.y - 100)).toBe(540);
  });

  it("labels every three hours", () => {
    expect(dialLabels.map((label) => label.text)).toEqual(["12a", "3a", "6a", "9a", "12p", "3p", "6p", "9p"]);
  });
});

describe("dragging", () => {
  it("keeps a drag across midnight at the end of the day instead of jumping", () => {
    expect(unwrap(0, 1440)).toBe(1440);
    expect(unwrap(15, 1425)).toBe(1455);
    expect(unwrap(1425, 0)).toBe(-15);
    expect(unwrap(600, 540)).toBe(600);
    expect(moveEnd(defaultHours, "close", unwrap(15, 1425))).toEqual({ open: 540, close: DAY });
    expect(moveEnd(defaultHours, "open", unwrap(1425, 0))).toEqual({ open: 0, close: 1020 });
  });

  it("never lets the ends cross and keeps at least 30 minutes open", () => {
    expect(moveEnd(defaultHours, "open", 1200)).toEqual({ open: 990, close: 1020 });
    expect(moveEnd(defaultHours, "close", 300)).toEqual({ open: 540, close: 570 });
  });

  it("moves the whole range without changing its length, inside the day", () => {
    expect(shiftRange(defaultHours, 60)).toEqual({ open: 600, close: 1080 });
    expect(shiftRange(defaultHours, 900)).toEqual({ open: 960, close: DAY });
    expect(shiftRange(defaultHours, -900)).toEqual({ open: 0, close: 480 });
  });

  it("moves the nearer end on a tap, measured around the clock", () => {
    expect(nearestEnd(defaultHours, 480)).toBe("open");
    expect(nearestEnd(defaultHours, 1100)).toBe("close");
    expect(nearestEnd({ open: 60, close: 1380 }, 1435)).toBe("close");
    expect(nearestEnd({ open: 60, close: 1380 }, 15)).toBe("open");
  });
});
