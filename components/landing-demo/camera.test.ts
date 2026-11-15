import { describe, expect, it } from "vitest";
import macbook from "../../public/landing-assets/guided-demo/macbook-gpt-v3.json";
import { cameraAt } from "./camera";
import { chapterAt } from "./timeline";

const viewports = [
  { width: 1500, height: 860 },
  { width: 390, height: 844 },
  { width: 375, height: 667 },
  { width: 844, height: 390 },
  { width: 667, height: 375 },
];

describe("one continuous MacBook aperture and onboarding card", () => {
  it("allows a smaller story hero without separating hardware from its aperture", () => {
    const viewport = viewports[0];
    const options = { heroScale: 0.86, heroCenterY: 0.65 };
    const initial = cameraAt(viewport, macbook, 0, options);
    expect(initial.hardware.width).toBeCloseTo(
      cameraAt(viewport, macbook, 0).hardware.width * 0.86,
    );
    for (const entry of [0, 0.2, 0.6]) {
      const { hardware, screen } = cameraAt(viewport, macbook, entry, options);
      expect(screen.left).toBeCloseTo(
        hardware.left + hardware.width * macbook.screenQuad[0].x,
        7,
      );
      expect(screen.top).toBeCloseTo(
        hardware.top + hardware.height * macbook.screenQuad[0].y,
        7,
      );
    }
    expect(cameraAt(viewport, macbook, 1, options).screen).toEqual(
      cameraAt(viewport, macbook, 1).screen,
    );
  });
  it.each(viewports)(
    "has no final-frame geometry or card-size jump at $width×$height",
    (viewport) => {
      const before = cameraAt(viewport, macbook, 1 - 1e-6);
      const after = cameraAt(viewport, macbook, 1);
      for (const box of ["screen", "card"] as const) {
        for (const key of ["left", "top", "width", "height"] as const) {
          expect(Math.abs(before[box][key] - after[box][key])).toBeLessThan(
            0.01,
          );
        }
      }

      expect(after.screen).toEqual({
        left: 0,
        top: 0,
        width: viewport.width,
        height: viewport.height,
      });
    },
  );
  it.each(viewports)(
    "keeps the visible hardware uniformly scaled and aligned at $width×$height",
    (viewport) => {
      for (const entry of [0, 0.1, 0.25, 0.4, 0.6]) {
        const { hardware, screen } = cameraAt(viewport, macbook, entry);
        expect(hardware.opacity).toBeGreaterThan(0);
        expect(hardware.width / hardware.height).toBeCloseTo(
          macbook.width / macbook.height,
          10,
        );
        const [tl, tr, , bl] = macbook.screenQuad;
        expect(screen.left).toBeCloseTo(
          hardware.left + hardware.width * tl.x,
          7,
        );
        expect(screen.top).toBeCloseTo(
          hardware.top + hardware.height * tl.y,
          7,
        );
        expect(screen.width).toBeCloseTo(hardware.width * (tr.x - tl.x), 7);
        expect(screen.height).toBeCloseTo(hardware.height * (bl.y - tl.y), 7);
      }
    },
  );
  it.each(viewports)(
    "reserves room for every initial category tile at $width×$height",
    (viewport) => {
      const { card } = cameraAt(viewport, macbook, 0);
      // The first question has one title line and two tile rows. Account for the
      // actual border/padding/icon floor, not just the tiles' min-height.
      const tileHeight = Math.max(
        card.categoryHeight,
        card.iconSize + 2 * card.categoryPadding + 2,
      );
      const required =
        2 +
        2 * card.padding +
        card.brandHeight +
        card.brandGap +
        card.questionSize * 1.15 +
        card.questionGap +
        2 * tileHeight +
        card.categoryGap;
      expect(required).toBeLessThan(card.height);
    },
  );
  it("uses static camera endpoints for reduced motion", () => {
    for (const progress of [0.1, 0.16, 0.219]) {
      expect(
        cameraAt(viewports[0], macbook, chapterAt(progress, true).entry),
      ).toEqual(cameraAt(viewports[0], macbook, 0));
    }
    expect(
      cameraAt(viewports[0], macbook, chapterAt(0.22, true).entry),
    ).toEqual(cameraAt(viewports[0], macbook, 1));
  });
  it("is a stateless projection through reverse and fast seeks", () => {
    const viewport = viewports[0];
    const seeks = [0, 0.2, 0.7, 0.999999, 1, 0.8, 0.1, 0];
    const frames = seeks.map((entry) => cameraAt(viewport, macbook, entry));
    expect(frames).toEqual(
      [...seeks]
        .reverse()
        .map((entry) => cameraAt(viewport, macbook, entry))
        .reverse(),
    );
    expect(frames[0]).toEqual(frames.at(-1));
  });
  it.each(viewports)(
    "fits a complete initial card and final reachable card at $width×$height",
    (viewport) => {
      const initial = cameraAt(viewport, macbook, 0);
      expect(initial.card.width).toBeLessThan(initial.screen.width);
      expect(initial.card.height).toBeLessThan(initial.screen.height);
      const final = cameraAt(viewport, macbook, 1);
      expect(final.card.top).toBeGreaterThan(100);
      expect(final.card.top + final.card.height).toBeLessThan(
        viewport.height - 10,
      );
    },
  );
});
