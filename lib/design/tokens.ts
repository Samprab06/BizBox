/**
 * Typed mirror of the design tokens in app/workspace.css, for code that cannot
 * read CSS variables: three.js materials need literal colors, and SVG can use
 * `colorVar()`. tokens.test.ts fails if this file and the CSS drift apart.
 * This is the only place outside the CSS where color literals may live.
 */

export const screenColors = {
  canvas: "#101115",
  "panel-raised": "#18191f",
  ink: "#f7f7fa",
  muted: "#dedee5",
  line: "rgba(255, 255, 255, 0.19)",
  accent: "#f3f3f6",
  "accent-hover": "#ffffff",
  "on-accent": "#17181d",
  warn: "#f0d7af",
  danger: "#ffbfbf",
  baseline: "#f3f3f6",
  alternative: "#dedee5",
} as const;

export type ColorToken = keyof typeof screenColors;

/** Values the `@media print` block overrides; tokens not listed keep their screen value. */
export const printColors: Partial<Record<ColorToken, string>> = {
  canvas: "#ffffff",
  "panel-raised": "#ffffff",
  ink: "#17181d",
  muted: "#17181d",
  line: "#dedee5",
  accent: "#17181d",
  "accent-hover": "#101115",
  "on-accent": "#ffffff",
  warn: "#754900",
  danger: "#a02828",
  baseline: "#17181d",
  alternative: "#17181d",
};

/** CSS reference that follows the active (screen or print) palette. */
export function colorVar(token: ColorToken): string {
  return `var(--color-${token})`;
}

/** Literal color for canvas/WebGL code, which cannot resolve CSS variables. */
export function colorValue(token: ColorToken): string {
  return screenColors[token];
}
