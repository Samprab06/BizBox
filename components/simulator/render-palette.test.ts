import { afterEach, describe, expect, it, vi } from "vitest";
afterEach(() => vi.unstubAllGlobals());
import {
  opaqueRenderColor,
  readRenderPalette,
  renderTokens,
} from "./render-palette";

describe("renderer color boundary", () => {
  it("composites translucent tokens into opaque renderer-compatible RGB", () => {
    expect(opaqueRenderColor("rgba(255, 255, 255, 0.5)", [0, 0, 0])).toBe(
      "rgb(128, 128, 128)",
    );
    expect(opaqueRenderColor("#fff8", [0, 0, 0])).toBe("rgb(136, 136, 136)");
  });
  it("accepts computed RGB formats and rejects unresolved variables", () => {
    expect(opaqueRenderColor("rgb(20 30 40 / 100%)", [0, 0, 0])).toBe(
      "rgb(20, 30, 40)",
    );
    expect(() => opaqueRenderColor("var(--color-ink)", [0, 0, 0])).toThrow();
  });
  it("reads each named token once per palette, using the canvas for alpha backing", () => {
    const reads: string[] = [];
    const palette = readRenderPalette((token) => {
      reads.push(token);
      return token === "canvas"
        ? "rgb(10, 20, 30)"
        : "rgba(255, 255, 255, 0.5)";
    });
    expect(reads).toEqual([...renderTokens]);
    expect(palette.ink).toBe("rgb(133, 138, 143)");
    for (const value of Object.values(palette))
      expect(value).toMatch(/^rgb\(\d+, \d+, \d+\)$/);
  });
});

it("fails clearly outside a mounted document instead of evaluating DOM during module import", () => {
  vi.stubGlobal("document", undefined);
  expect(() => readRenderPalette()).toThrow("mounted document");
});
it("rejects missing production tokens and removes its temporary probe", () => {
  const remove = vi.fn();
  const root = { append: vi.fn() };
  const probe = { hidden: false, style: { color: "" }, remove };
  vi.stubGlobal("document", {
    documentElement: root,
    createElement: () => probe,
  });
  vi.stubGlobal("getComputedStyle", (node: unknown) =>
    node === root ? { getPropertyValue: () => "" } : { color: "rgb(0, 0, 0)" },
  );
  expect(() => readRenderPalette()).toThrow(
    "Missing renderer token: --color-canvas",
  );
  expect(remove).toHaveBeenCalledOnce();
});
it("rejects unsupported computed colors rather than forwarding them to a renderer", () => {
  expect(() => readRenderPalette(() => "currentColor")).toThrow(
    "Unresolved renderer color",
  );
});
