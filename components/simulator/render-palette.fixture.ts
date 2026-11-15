// Node-only rendering tests read canonical values from the same CSS as the browser.
import { readFileSync } from "node:fs";
import {
  opaqueRenderColor,
  renderTokens,
  type RenderPalette,
} from "./render-palette";
const css = readFileSync(
  new URL("../../app/workspace.css", import.meta.url),
  "utf8",
);
export function fixtureRenderPalette(): RenderPalette {
  const raw = Object.fromEntries(
    renderTokens.map((token) => {
      const value = css.match(new RegExp(`--color-${token}:\\s*([^;]+);`))?.[1];
      if (!value) throw new Error(`Missing test renderer token: ${token}`);
      return [token, value.trim()];
    }),
  ) as RenderPalette;
  const canvas = opaqueRenderColor(raw.canvas, [0, 0, 0])
    .match(/\d+/g)!
    .map(Number) as [number, number, number];
  return Object.fromEntries(
    renderTokens.map((token) => [token, opaqueRenderColor(raw[token], canvas)]),
  ) as RenderPalette;
}
