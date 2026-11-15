import { describe, expect, it } from "vitest";
import { switchView, viewMinute, type HandoffState } from "./transition-state";

const hours = { openMin: 480, closeMin: 720 };
const street: HandoffState = {
  view: "city",
  siteId: "montrose",
  runIndex: 1,
  minute: 612.4,
  playing: true,
  selected: "customer-7",
  following: true,
};

/** One clock tick, as the host's single playback loop applies it. */
const tick = (state: HandoffState, by: number): HandoffState => ({
  ...state,
  minute: Math.min(hours.closeMin, state.minute + by),
});

describe("HAC-99 city ↔ interior handoff", () => {
  it("does not move the clock entering the interior or going back to the street", () => {
    const inside = switchView(street, "interior");
    expect(inside.minute).toBe(street.minute);
    expect(viewMinute("interior", inside.minute, hours)).toBe(
      viewMinute("city", street.minute, hours),
    );
    const back = switchView(inside, "city");
    expect(back.minute).toBe(street.minute);
    expect(viewMinute("city", back.minute, hours)).toBe(612.4);
  });

  it("resumes the street at the minute the interior reached while playing", () => {
    let state = switchView(street, "interior");
    for (let frame = 0; frame < 30; frame += 1) state = tick(state, 0.25);
    const shownInside = viewMinute("interior", state.minute, hours);
    const back = switchView(state, "city");
    expect(back.playing).toBe(true);
    expect(viewMinute("city", back.minute, hours)).toBe(shownInside);
    expect(back.minute).toBeCloseTo(street.minute + 7.5, 10);
  });

  it("clamps outside opening hours for the interior display only", () => {
    const night = { ...street, minute: 1300 };
    const inside = switchView(night, "interior");
    expect(viewMinute("interior", inside.minute, hours)).toBe(720);
    // The shared minute was never rewritten, so the street returns to 21:40.
    expect(switchView(inside, "city").minute).toBe(1300);
    expect(viewMinute("interior", 30, hours)).toBe(480);
  });

  it("keeps the site, run, selection and follow state in both directions", () => {
    const inside = switchView(street, "interior");
    const back = switchView(inside, "city");
    for (const state of [inside, back]) {
      expect(state.siteId).toBe("montrose");
      expect(state.runIndex).toBe(1);
      expect(state.selected).toBe("customer-7");
      expect(state.following).toBe(true);
    }
    expect(back).toEqual(street);
  });

  it("is a no-op when the requested view is already shown", () => {
    expect(switchView(street, "city")).toBe(street);
    const inside = switchView(street, "interior");
    expect(switchView(inside, "interior")).toBe(inside);
  });
});
