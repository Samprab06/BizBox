import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  colorValue,
  colorVar,
  printColors,
  screenColors,
  type ColorToken,
} from "./tokens";

const css = readFileSync(
  new URL("../../app/workspace.css", import.meta.url),
  "utf8",
);
const block = (re: RegExp) => {
  const body = css.match(re)?.[1];
  if (!body) throw new Error(`Missing CSS block ${re}`);
  return new Map(
    Array.from(body.matchAll(/--color-([\w-]+):\s*([^;]+);/g), (m) => [
      m[1],
      m[2].trim().toLowerCase(),
    ]),
  );
};
const theme = block(/@theme(?:\s+static)?\s*\{([^}]+)\}/);
const print = block(/@media print\s*\{\s*:root\s*\{([^}]+)\}/);

describe("design token map", () => {
  it("matches every screen color in app/workspace.css", () => {
    for (const [token, value] of Object.entries(screenColors))
      expect(theme.get(token), token).toBe(value);
  });

  it("matches every print override in app/workspace.css", () => {
    for (const [token, value] of Object.entries(printColors))
      expect(print.get(token), token).toBe(value);
  });

  it("only overrides tokens that exist", () => {
    for (const token of Object.keys(printColors))
      expect(token in screenColors).toBe(true);
  });

  it("exposes CSS variables and literal values", () => {
    expect(colorVar("ink")).toBe("var(--color-ink)");
    expect(colorValue("canvas")).toBe("#101115");
    const t: ColorToken = "warn";
    expect(colorValue(t)).toBe(screenColors.warn);
  });

  it("leaves no color literals in the restyled components", () => {
    const root = new URL("../../components/", import.meta.url).pathname;
    const files: string[] = [];
    const walk = (dir: string) => {
      for (const name of readdirSync(dir)) {
        const path = join(dir, name);
        if (statSync(path).isDirectory()) walk(path);
        else files.push(path);
      }
    };
    for (const dir of ["comparison", "replay", "decision", "plan"])
      walk(join(root, dir));
    files.push(join(root, "live-comparison-workspace.tsx"));
    const literal = /#[0-9a-f]{3,8}\b|\brgba?\(/i;
    const offenders = files.filter(
      (f) =>
        /\.tsx?$/.test(f) &&
        !/\.test\./.test(f) &&
        literal.test(readFileSync(f, "utf8")),
    );
    expect(offenders).toEqual([]);
  });
});
