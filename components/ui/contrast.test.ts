import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const css = readFileSync(
  new URL("../../app/workspace.css", import.meta.url),
  "utf8",
);
function rgb(token: string): number[] {
  const hex = css.match(
    new RegExp(`--color-${token}:\\s*(#[0-9a-f]{6})`, "i"),
  )?.[1];
  if (!hex) throw new Error(`Missing solid color token: ${token}`);
  return [1, 3, 5].map((offset) => parseInt(hex.slice(offset, offset + 2), 16));
}
function luminance(channels: number[]): number {
  const [r, g, b] = channels.map((channel) => {
    const value = channel / 255;
    return value <= 0.04045 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}
function contrast(foreground: number[], background: number[]): number {
  const a = luminance(foreground);
  const b = luminance(background);
  return (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05);
}

describe("WCAG AA normal text contrast", () => {
  for (const prefix of ["", "viewport-"]) {
    for (const foreground of [
      "ink",
      "muted",
      "baseline",
      "alternative",
      "warn",
      "danger",
    ]) {
      for (const background of prefix
        ? ["canvas", "surface"]
        : ["paper", "surface"]) {
        it(`${prefix}${foreground} on ${prefix}${background} is at least 4.5:1`, () => {
          expect(
            contrast(
              rgb(`${prefix}${foreground}`),
              rgb(`${prefix}${background}`),
            ),
          ).toBeGreaterThanOrEqual(4.5);
        });
      }
    }
    for (const kind of ["source", "input", "assumption", "simulation"]) {
      it(`${prefix}${kind} evidence badge is at least 4.5:1`, () => {
        expect(
          contrast(
            rgb(`${prefix}evidence-${kind}-ink`),
            rgb(`${prefix}evidence-${kind}-surface`),
          ),
        ).toBeGreaterThanOrEqual(4.5);
      });
    }
    it(`${prefix}glass text stays readable over either extreme of a spatial canvas`, () => {
      for (const underlay of [0, 255]) {
        // GlassControl has a 94% solid surface over the map/viewport.
        const background = rgb(`${prefix}surface`).map(
          (channel) => 0.94 * channel + 0.06 * underlay,
        );
        expect(
          contrast(rgb(`${prefix}ink`), background),
        ).toBeGreaterThanOrEqual(4.5);
        expect(
          contrast(rgb(`${prefix}muted`), background),
        ).toBeGreaterThanOrEqual(4.5);
      }
    });
  }
  it("primary action text is at least 4.5:1", () => {
    expect(contrast(rgb("on-pine"), rgb("pine"))).toBeGreaterThanOrEqual(4.5);
  });
});
