import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { compile } from "tailwindcss";

const css = readFileSync(
  new URL("../../app/workspace.css", import.meta.url),
  "utf8",
);
type Rgb = [number, number, number];
type Rgba = [...Rgb, number];
type Tokens = Map<string, string>;
const theme = css.match(/@theme(?:\s+static)?\s*\{([^}]+)\}/)?.[1];
if (!theme) throw new Error("Missing @theme color foundation");
const tokens: Tokens = new Map(
  Array.from(theme.matchAll(/--color-([\w-]+):\s*([^;]+);/g), (match) => [
    match[1],
    match[2].trim(),
  ]),
);

/** Resolve aliases before parsing; alpha colors need an explicit opaque underlay. */
function color(
  token: string,
  palette = tokens,
  visited = new Set<string>(),
): Rgba {
  if (visited.has(token)) throw new Error(`Circular color alias: ${token}`);
  visited.add(token);
  const value = palette.get(token);
  if (!value) throw new Error(`Missing color token: ${token}`);
  const alias = value.match(/^var\(\s*--color-([\w-]+)\s*\)$/);
  if (alias) return color(alias[1], palette, visited);

  const hex = value.match(/^#([\da-f]{3,4}|[\da-f]{6}|[\da-f]{8})$/i)?.[1];
  if (hex) {
    const expanded =
      hex.length <= 4
        ? Array.from(hex, (digit) => digit + digit).join("")
        : hex;
    return [
      parseInt(expanded.slice(0, 2), 16),
      parseInt(expanded.slice(2, 4), 16),
      parseInt(expanded.slice(4, 6), 16),
      expanded.length === 8 ? parseInt(expanded.slice(6, 8), 16) / 255 : 1,
    ];
  }

  const channels = value
    .match(/^rgba?\(([^)]+)\)$/i)?.[1]
    .trim()
    .split(/[\s,/]+/);
  if (channels && (channels.length === 3 || channels.length === 4)) {
    const rgb = channels
      .slice(0, 3)
      .map((channel) =>
        channel.endsWith("%")
          ? (parseFloat(channel) / 100) * 255
          : Number(channel),
      );
    const alpha = channels[3] ?? "1";
    const opacity = alpha.endsWith("%")
      ? parseFloat(alpha) / 100
      : Number(alpha);
    if (
      rgb.every(
        (channel) => Number.isFinite(channel) && channel >= 0 && channel <= 255,
      ) &&
      Number.isFinite(opacity) &&
      opacity >= 0 &&
      opacity <= 1
    ) {
      return [rgb[0], rgb[1], rgb[2], opacity];
    }
  }
  throw new Error(`Unsupported color token: ${token} (${value})`);
}
function composite([r, g, b, alpha]: Rgba, underlay: Rgb): Rgb {
  return [r, g, b].map(
    (channel, index) => alpha * channel + (1 - alpha) * underlay[index],
  ) as Rgb;
}
function rgb(token: string, underlay?: Rgb, palette = tokens): Rgb {
  const resolved = color(token, palette);
  if (resolved[3] < 1 && !underlay) {
    throw new Error(`Translucent color needs an underlay: ${token}`);
  }
  return composite(resolved, underlay ?? [0, 0, 0]);
}
function luminance(channels: Rgb): number {
  const [r, g, b] = channels.map((channel) => {
    const value = channel / 255;
    return value <= 0.04045 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}
function contrast(foreground: Rgb, background: Rgb): number {
  const a = luminance(foreground);
  const b = luminance(background);
  return (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05);
}

// These are parser fixtures, not proposed or approved BizBox palette values.
describe("contrast color resolution", () => {
  const palette = new Map([
    ["solid", "#123"],
    ["alias", "var(--color-solid)"],
    ["short-alpha", "#fff8"],
    ["hex-alpha", "#ffffff80"],
    ["modern", "rgb(255 255 255 / 40%)"],
    ["legacy", "rgba(255, 255, 255, 0.4)"],
    ["percentage", "rgb(100% 100% 100% / 40%)"],
    ["cycle", "var(--color-cycle)"],
    ["unsupported", "currentColor"],
    ["invalid", "rgb(300 0 0)"],
  ]);
  it("resolves solid tokens and legacy aliases identically", () => {
    expect(color("alias", palette)).toEqual([17, 34, 51, 1]);
  });
  it("reads both alpha hex formats", () => {
    expect(color("short-alpha", palette)).toEqual([255, 255, 255, 136 / 255]);
    expect(color("hex-alpha", palette)).toEqual([255, 255, 255, 128 / 255]);
  });
  it.each(["modern", "legacy", "percentage"])(
    "composites %s alpha over its underlay",
    (token) => {
      expect(composite(color(token, palette), [0, 0, 0])).toEqual([
        102, 102, 102,
      ]);
      expect(composite(color(token, palette), [255, 255, 255])).toEqual([
        255, 255, 255,
      ]);
    },
  );
  it.each(["missing", "cycle", "unsupported", "invalid"])(
    "rejects %s instead of skipping a contrast check",
    (token) => {
      expect(() => color(token, palette)).toThrow();
    },
  );
  it("uses the WCAG black/white reference ratio", () => {
    expect(contrast([0, 0, 0], [255, 255, 255])).toBe(21);
  });
});

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
            rgb(`${prefix}evidence-${kind}-surface`, rgb(`${prefix}surface`)),
          ),
        ).toBeGreaterThanOrEqual(4.5);
      });
    }
    it(`${prefix}glass text stays readable over either extreme of a spatial canvas`, () => {
      for (const underlay of [0, 255]) {
        // GlassControl currently has a 94% surface fill over the map/viewport.
        const [r, g, b, alpha] = color(`${prefix}surface`);
        const background = composite(
          [r, g, b, alpha * 0.94],
          [underlay, underlay, underlay],
        );
        expect(
          contrast(rgb(`${prefix}ink`, background), background),
        ).toBeGreaterThanOrEqual(4.5);
        expect(
          contrast(rgb(`${prefix}muted`, background), background),
        ).toBeGreaterThanOrEqual(4.5);
      }
    });
  }
  it("primary action text is at least 4.5:1", () => {
    expect(contrast(rgb("on-pine"), rgb("pine"))).toBeGreaterThanOrEqual(4.5);
  });
});

const printBlock = css.match(/@media print\s*\{\s*:root\s*\{([^}]+)\}/)?.[1];
const printTokens: Tokens = new Map(tokens);
for (const match of (printBlock ?? "").matchAll(
  /--color-([\w-]+):\s*([^;]+);/g,
)) {
  printTokens.set(match[1], match[2].trim());
}

for (const [mode, palette] of [
  ["screen", tokens],
  ["print", printTokens],
] as const) {
  describe(`${mode} Stage 2 semantic pairs`, () => {
    it("defines a separate opaque light print palette", () => {
      expect(printBlock).toBeDefined();
      expect(luminance(rgb("canvas", undefined, printTokens))).toBeGreaterThan(
        0.9,
      );
    });
    const canvas = () => rgb("canvas", undefined, palette);
    const surfaces = () => [
      canvas(),
      rgb("surface", canvas(), palette),
      rgb("panel-raised", canvas(), palette),
      rgb("glass-fill", canvas(), palette),
      rgb("field", rgb("panel-raised", canvas(), palette), palette),
    ];
    for (const foreground of [
      "ink",
      "muted",
      "baseline",
      "alternative",
      "warn",
      "danger",
      "accent",
    ]) {
      it(`${foreground} reads on every supported surface at 4.5:1`, () => {
        for (const background of surfaces()) {
          expect(
            contrast(rgb(foreground, background, palette), background),
          ).toBeGreaterThanOrEqual(4.5);
        }
      });
    }
    for (const action of ["accent", "accent-hover"]) {
      it(`on-accent reads on ${action} at 4.5:1`, () => {
        const background = rgb(action, undefined, palette);
        expect(
          contrast(rgb("on-accent", background, palette), background),
        ).toBeGreaterThanOrEqual(4.5);
      });
    }
    for (const kind of ["source", "input", "assumption", "simulation"]) {
      it(`${kind} evidence reads on each supported underlying surface at 4.5:1`, () => {
        for (const underlay of surfaces()) {
          const background = rgb(`evidence-${kind}-surface`, underlay, palette);
          expect(
            contrast(
              rgb(`evidence-${kind}-ink`, background, palette),
              background,
            ),
          ).toBeGreaterThanOrEqual(4.5);
        }
      });
    }
    for (const role of ["agent-customer", "agent-employee"]) {
      it(`${role} marks stay visible on supported canvas surfaces at 3:1`, () => {
        for (const background of surfaces()) {
          expect(
            contrast(rgb(role, background, palette), background),
          ).toBeGreaterThanOrEqual(3);
        }
      });
    }
    it("focus and control boundaries meet 3:1", () => {
      for (const background of surfaces()) {
        for (const foreground of ["focus-ring", "glass-edge"]) {
          expect(
            contrast(rgb(foreground, background, palette), background),
          ).toBeGreaterThanOrEqual(3);
        }
      }
    });
    it("uses a readable backed glass fallback over black or white imagery", () => {
      for (const underlay of [0, 255]) {
        const background = rgb(
          "glass-fallback",
          [underlay, underlay, underlay],
          palette,
        );
        for (const foreground of ["ink", "muted"]) {
          expect(
            contrast(rgb(foreground, background, palette), background),
          ).toBeGreaterThanOrEqual(4.5);
        }
      }
    });
  });
}

it("generates Tailwind utilities for every foundation token", async () => {
  const foundation = css.match(/@theme(?:\s+static)?\s*\{[^}]+\}/)?.[0];
  expect(foundation).toBeDefined();
  const compiler = await compile(`${foundation}\n@tailwind utilities;`);
  const utilities = [
    ...Array.from(tokens.keys(), (name) => `bg-${name}`),
    "font-sans",
    "rounded-control",
    "rounded-panel",
    "rounded-sheet",
    "rounded-card",
    "p-card",
    "backdrop-blur-glass",
    "shadow-glass",
    "duration-question",
    "ease-question",
  ];
  const output = compiler.build(utilities);
  for (const utility of utilities) expect(output).toContain(`.${utility} {`);
});

// The engines read these at runtime; production CSS must retain them without DOM classes.
it("retains renderer-only colors without requesting their utilities", async () => {
  const foundation = css.match(/@theme\s+static\s*\{[^}]+\}/)?.[0];
  expect(foundation).toBeDefined();
  const compiler = await compile(`${foundation}\n@tailwind utilities;`);
  const output = compiler.build(["bg-canvas"]);
  for (const role of ["agent-customer", "agent-employee"]) {
    expect(output).toContain(`--color-${role}: ${tokens.get(role)};`);
  }
});
