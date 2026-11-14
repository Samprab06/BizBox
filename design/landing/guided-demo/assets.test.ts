import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import manifest from "../../../public/landing-assets/guided-demo/macbook-frame-v2.json";
import provenance from "./assets.json";

const root = resolve(import.meta.dirname, "../../..");
describe("prepared guided demo media", () => {
  it("ships the native generated scene dimensions and their exact prompts", () => {
    const prompts = JSON.parse(
      readFileSync(resolve(import.meta.dirname, "prompts.json"), "utf8"),
    );
    for (const asset of provenance.assets) {
      const png = readFileSync(resolve(root, asset.asset));
      expect(png.subarray(0, 8).toString("hex")).toBe("89504e470d0a1a0a");
      expect([png.readUInt32BE(16), png.readUInt32BE(20)]).toEqual(
        asset.dimensions,
      );
      const promptName = asset.prompt.split("#")[1];
      expect(prompts[promptName].length).toBeGreaterThan(100);
      expect(asset.geography).toMatch(/Illustrative/);
    }
  });
  it("provides an RGBA MacBook and an upright, in-bounds display aperture", () => {
    const frame = readFileSync(resolve(root, "public" + manifest.image));
    expect([frame.readUInt32BE(16), frame.readUInt32BE(20)]).toEqual([
      manifest.width,
      manifest.height,
    ]);
    expect(frame[25]).toBe(6); // PNG RGBA color type, needed for the display holdout.
    const [tl, tr, br, bl] = manifest.screenQuad;
    for (const p of manifest.screenQuad) {
      expect(p.x).toBeGreaterThan(0);
      expect(p.x).toBeLessThan(1);
      expect(p.y).toBeGreaterThan(0);
      expect(p.y).toBeLessThan(1);
    }
    expect(tl.x).toBeLessThan(tr.x);
    expect(tl.y).toBeLessThan(bl.y);
    expect(tr.y).toBe(tl.y);
    expect(br.y).toBe(bl.y);
    expect(
      ((tr.x - tl.x) * manifest.width) / ((bl.y - tl.y) * manifest.height),
    ).toBeCloseTo(1.5451, 3);
  });
});
