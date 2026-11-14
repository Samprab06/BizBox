import { describe, expect, it } from "vitest";
import { screenTransform, cssScreenTransform } from "./screen-transform.js";

type Point = { x: number; y: number };
const width = 1600,
  height = 1036;
function project(m: number[], x: number, y: number): Point {
  const w = m[3] * x + m[7] * y + m[15];
  return {
    x: (m[0] * x + m[4] * y + m[12]) / w,
    y: (m[1] * x + m[5] * y + m[13]) / w,
  };
}
describe("live product screen projection", () => {
  const cases: Point[][] = [
    [
      { x: 0, y: 0 },
      { x: 1600, y: 0 },
      { x: 1600, y: 1036 },
      { x: 0, y: 1036 },
    ],
    [
      { x: 550, y: 260 },
      { x: 1090, y: 285 },
      { x: 1050, y: 620 },
      { x: 510, y: 580 },
    ],
    [
      { x: 80, y: 295 },
      { x: 322, y: 304 },
      { x: 304, y: 470 },
      { x: 65, y: 455 },
    ],
    [
      { x: -400, y: -250 },
      { x: 1800, y: -100 },
      { x: 1730, y: 1200 },
      { x: -460, y: 1100 },
    ],
  ];
  cases.forEach((corners, index) =>
    it(`matches all display corners in pose ${index}`, () => {
      const matrix = screenTransform(corners, width, height)!;
      const source = [
        [0, 0],
        [width, 0],
        [width, height],
        [0, height],
      ];
      source.forEach(([x, y], i) => {
        const actual = project(matrix, x, y);
        expect(actual.x).toBeCloseTo(corners[i].x, 7);
        expect(actual.y).toBeCloseTo(corners[i].y, 7);
      });
    }),
  );
  it("rejects collapsed or invalid surfaces instead of stretching the iframe", () => {
    expect(
      screenTransform(
        [
          { x: 0, y: 0 },
          { x: 1, y: 0 },
          { x: 2, y: 0 },
          { x: 3, y: 0 },
        ],
        width,
        height,
      ),
    ).toBeNull();
    expect(screenTransform(cases[0], 0, height)).toBeNull();
    expect(
      screenTransform([{ x: NaN, y: 0 }, ...cases[0].slice(1)], width, height),
    ).toBeNull();
  });
  it("keeps a full-resolution UI aligned after CSS coefficient serialization", () => {
    const corners = cases[1];
    const matrix = cssScreenTransform(corners, width, height)!;
    expect(matrix[15]).toBe(16);
    const css = matrix.map((value) => Number(value.toFixed(6)));
    [
      [0, 0],
      [width, 0],
      [width, height],
      [0, height],
    ].forEach(([x, y], i) => {
      const actual = project(css, x, y);
      expect(
        Math.hypot(actual.x - corners[i].x, actual.y - corners[i].y),
      ).toBeLessThan(0.05);
    });
  });
});
