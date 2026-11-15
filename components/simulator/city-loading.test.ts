import { describe, expect, it } from "vitest";
import {
  DECODER_COUNT,
  SKIP_OFFER_MS,
  describeCityLoad,
  initialCityLoad,
  reduceCityLoad,
  type CityLoadEvent,
  type CityLoadState,
} from "./city-loading";

const run = (events: CityLoadEvent[], state = initialCityLoad()) =>
  events.reduce(reduceCityLoad, state);

const started = (at = 1000) => run([{ type: "start", at }]);

describe("city cold-load stages", () => {
  it("walks the measured stages in order", () => {
    let state = started();
    expect(describeCityLoad(state, 1000)).toMatchObject({
      stage: "engine",
      title: "Loading the 3D engine",
      step: { index: 1, total: 4 },
    });
    state = run([{ type: "engine-ready" }], state);
    expect(describeCityLoad(state, 1500)).toMatchObject({
      stage: "decoders",
      detail: `0 of ${DECODER_COUNT} ready`,
      step: { index: 2, total: 4 },
    });
    state = run([{ type: "decoder-ready" }], state);
    expect(describeCityLoad(state, 1500).detail).toBe("1 of 2 ready");
    state = run([{ type: "decoder-ready" }], state);
    expect(describeCityLoad(state, 1500).stage).toBe("imagery");
    state = run([{ type: "imagery-ready" }], state);
    state = run([{ type: "progress", pending: 17, processing: 3 }], state);
    expect(describeCityLoad(state, 2000)).toMatchObject({
      stage: "tiles",
      title: "Streaming buildings",
      detail: "0 tiles ready · 17 downloading · 3 decoding",
      step: { index: 4, total: 4 },
    });
  });

  it("reports imagery that arrives before the decoders without skipping a stage", () => {
    const state = run(
      [{ type: "engine-ready" }, { type: "imagery-ready" }],
      started(),
    );
    expect(describeCityLoad(state, 1200).stage).toBe("decoders");
  });

  it("never reports a percentage or an invented total", () => {
    const state = run(
      [
        { type: "engine-ready" },
        { type: "decoder-ready" },
        { type: "decoder-ready" },
        { type: "imagery-ready" },
        { type: "tile-ready" },
        { type: "progress", pending: 0, processing: 0 },
      ],
      started(),
    );
    const view = describeCityLoad(state, 5000);
    expect(view.detail).toBe("1 tile ready");
    expect(JSON.stringify(view)).not.toMatch(/%/);
  });

  it("counts elapsed whole seconds and freezes them at the first building", () => {
    let state = started(1000);
    expect(describeCityLoad(state, 7999).elapsedSeconds).toBe(6);
    state = run([{ type: "first-building", at: 9400 }], state);
    const view = describeCityLoad(state, 30000);
    expect(view).toMatchObject({ stage: "refining", elapsedSeconds: 8 });
  });

  it("shows zero elapsed time before the scene starts", () => {
    expect(describeCityLoad(initialCityLoad(), 123456).elapsedSeconds).toBe(0);
  });

  it("offers a skip only after the budget passes and only while loading", () => {
    const state = started(1000);
    expect(describeCityLoad(state, 1000 + SKIP_OFFER_MS - 1).offerSkip).toBe(
      false,
    );
    expect(describeCityLoad(state, 1000 + SKIP_OFFER_MS).offerSkip).toBe(true);
    const visible = run([{ type: "first-building", at: 2000 }], state);
    expect(describeCityLoad(visible, 99999).offerSkip).toBe(false);
  });

  it("settles only after buildings render", () => {
    const empty = run([{ type: "settled", at: 1500 }], started());
    expect(empty.phase).toBe("loading");
    const settled = run(
      [
        { type: "first-building", at: 2000 },
        { type: "settled", at: 4000 },
      ],
      started(),
    );
    expect(settled).toMatchObject({ phase: "settled", settledAt: 4000 });
    expect(describeCityLoad(settled, 5000).stage).toBe("settled");
  });

  it("fails only before buildings are visible", () => {
    expect(run([{ type: "failed" }], started()).phase).toBe("failed");
    const visible = run(
      [{ type: "first-building", at: 2000 }, { type: "failed" }],
      started(),
    );
    expect(visible.phase).toBe("visible");
  });

  it("skips while loading, ignores late events, and restarts cleanly", () => {
    const skipped = run(
      [{ type: "skip" }, { type: "first-building", at: 5000 }],
      started(),
    );
    expect(skipped.phase).toBe("skipped");
    expect(describeCityLoad(skipped, 6000).stage).toBe("skipped");
    const restarted = run([{ type: "start", at: 7000 }], skipped);
    expect(restarted).toEqual(initialCityLoad(7000));
  });

  it("returns the same state for no-op events so React can bail out", () => {
    const state: CityLoadState = run(
      [{ type: "progress", pending: 4, processing: 1 }],
      started(),
    );
    expect(
      reduceCityLoad(state, { type: "progress", pending: 4, processing: 1 }),
    ).toBe(state);
    const settled = run(
      [
        { type: "first-building", at: 2000 },
        { type: "settled", at: 3000 },
      ],
      started(),
    );
    expect(reduceCityLoad(settled, { type: "tile-ready" })).toBe(settled);
    const twoDecoders = run(
      [{ type: "decoder-ready" }, { type: "decoder-ready" }],
      started(),
    );
    expect(reduceCityLoad(twoDecoders, { type: "decoder-ready" })).toBe(
      twoDecoders,
    );
  });
});
