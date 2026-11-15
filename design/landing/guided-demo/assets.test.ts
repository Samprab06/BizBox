import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import manifest from "../../../public/landing-assets/guided-demo/macbook-frame-v2.json";
import provenance from "./assets.json";
import mobileRevision from "./assets-v3.json";
import islandRevision from "./assets-v4.json";
import { createHash } from "node:crypto";

const root = resolve(import.meta.dirname, "../../..");
describe("one-checkout artwork", () => {
  it("ships the preserved edit at its native dimensions with prompt and provenance", () => {
    const prompts = JSON.parse(
      readFileSync(resolve(import.meta.dirname, "prompts-v3.json"), "utf8"),
    );
    for (const asset of [...mobileRevision.assets, ...islandRevision.assets]) {
      const png = readFileSync(resolve(root, asset.asset));
      expect([png.readUInt32BE(16), png.readUInt32BE(20)]).toEqual(
        asset.dimensions,
      );
      expect(createHash("sha256").update(png).digest("hex")).toBe(asset.sha256);
      expect(
        (asset.prompt.includes("v4.json")
          ? JSON.parse(
              readFileSync(
                resolve(import.meta.dirname, "prompts-v4.json"),
                "utf8",
              ),
            )
          : prompts)[asset.prompt.split("#")[1]],
      ).toBeTruthy();
      expect(
        readFileSync(resolve(root, asset.editTarget)).length,
      ).toBeGreaterThan(0);
    }
  });
});
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

describe("consultant landing revision media", () => {
  it("ships the new GPT views and frame at their recorded native dimensions", async () => {
    const { default: revision } = await import("./assets-v2.json");
    const prompts = JSON.parse(
      readFileSync(resolve(import.meta.dirname, "prompts-v2.json"), "utf8"),
    );
    for (const asset of revision.assets) {
      const png = readFileSync(resolve(root, asset.asset));
      expect(png.subarray(0, 8).toString("hex")).toBe("89504e470d0a1a0a");
      expect([png.readUInt32BE(16), png.readUInt32BE(20)]).toEqual(
        asset.dimensions,
      );
      expect(prompts[asset.prompt.split("#")[1]]).toBeTruthy();
    }
    expect(revision.geography).toMatch(/Illustrative/);
  });
  it("provides a measured opaque-screen cutout and an actual local font", async () => {
    const { default: mac } =
      await import("../../../public/landing-assets/guided-demo/macbook-gpt-v3.json");
    const png = readFileSync(resolve(root, "public" + mac.image));
    expect([png.readUInt32BE(16), png.readUInt32BE(20)]).toEqual([
      mac.width,
      mac.height,
    ]);
    expect(png[25]).toBe(6);
    expect(mac.screenOpaque).toBe(true);
    for (const [index, point] of mac.screenQuad.entries()) {
      expect(point.x * mac.width).toBeCloseTo(mac.screenPixels[index][0], 4);
      expect(point.y * mac.height).toBeCloseTo(mac.screenPixels[index][1], 4);
      expect(point.x).toBeGreaterThan(0);
      expect(point.x).toBeLessThan(1);
      expect(point.y).toBeGreaterThan(0);
      expect(point.y).toBeLessThan(1);
    }
    const font = readFileSync(resolve(root, "public/fonts/geist-latin.woff2"));
    expect(font.subarray(0, 4).toString()).toBe("wOF2");
    expect(
      readFileSync(resolve(root, "public/fonts/Geist-OFL.txt"), "utf8"),
    ).toContain("SIL OPEN FONT LICENSE");
  });
});
