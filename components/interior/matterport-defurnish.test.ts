import { describe, expect, it, vi } from "vitest";
import { watchDefurnishedViews, type ViewEntry } from "./matterport-defurnish";
function fixture() {
  let features!: (value: Record<string, boolean | undefined>) => void,
    views!: (value: Record<string, ViewEntry>) => void;
  const cancel = vi.fn();
  const sdk = {
    App: {
      Feature: { Defurnish: "feature.defurnish" },
      features: {
        subscribe: (observer: {
          onChanged: (value: Record<string, boolean | undefined>) => void;
        }) => {
          features = observer.onChanged;
          return { cancel };
        },
      },
    },
    View: {
      ViewType: {
        DEFURNISH: "viewtype.defurnish",
        BASE: "viewtype.base",
        LAYERED_BASE: "viewtype.layeredbase",
      },
      views: {
        subscribe: (observer: {
          onCollectionUpdated: (value: Record<string, ViewEntry>) => void;
        }) => {
          views = observer.onCollectionUpdated;
          return { cancel };
        },
      },
    },
  };
  return {
    sdk,
    features: (value: Record<string, boolean | undefined>) => features(value),
    views: (value: Record<string, ViewEntry>) => views(value),
    cancel,
  };
}
describe("existing per-model defurnished views", () => {
  it("does not claim generated views from a feature flag alone", () => {
    const f = fixture(),
      states: unknown[] = [];
    watchDefurnishedViews(f.sdk, (state) => states.push(state));
    f.features({ "feature.defurnish": true });
    f.views({});
    expect(states.at(-1)).toMatchObject({ availability: "unavailable" });
  });
  it("activates only actual generated views using the official setActive API", async () => {
    const f = fixture(),
      states: unknown[] = [];
    const controller = watchDefurnishedViews(f.sdk, (state) =>
      states.push(state),
    );
    const original = {
        id: "base",
        type: "viewtype.base",
        active: true,
        setActive: vi.fn(async () => {}),
      },
      empty = {
        id: "empty",
        type: "viewtype.defurnish",
        active: false,
        setActive: vi.fn(async () => {}),
      };
    f.features({ "feature.defurnish": true });
    f.views({ base: original, empty });
    expect(states.at(-1)).toMatchObject({ availability: "available" });
    await controller.activate("defurnished");
    expect(empty.setActive).toHaveBeenCalledWith(false);
    await controller.activate("original");
    expect(original.setActive).toHaveBeenCalledWith(false);
    controller.dispose();
    expect(f.cancel).toHaveBeenCalledTimes(2);
  });
  it("rejects unavailable and disposed requests without vendor generation", async () => {
    const f = fixture();
    const controller = watchDefurnishedViews(f.sdk, () => {});
    f.features({ "feature.defurnish": false });
    await expect(controller.activate("defurnished")).rejects.toThrow();
    controller.dispose();
    await expect(controller.activate("original")).rejects.toThrow();
  });
});
