import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import manifest from "../../public/landing-assets/prepared/manifest.json";
import provenance from "../../public/landing-assets/prepared/provenance.json";

describe("prepared landing delivery assets", () => {
  it("ships every referenced recording and poster under its actual content hash", () => {
    const scenes = [
      manifest.map,
      manifest.mapPortrait,
      ...Object.values(manifest.counters),
    ];
    for (const scene of scenes) {
      for (const path of [
        scene.poster,
        scene.mp4,
        scene.webm,
        ...("discoveryPoster" in scene ? [scene.discoveryPoster] : []),
      ]) {
        expect(path).toMatch(
          /^\/landing-assets\/prepared\/[\w-]+\.[a-f0-9]{12}\.(webp|mp4|webm)$/,
        );
        const bytes = readFileSync(join(process.cwd(), "public", path));
        const hash = createHash("sha256").update(bytes).digest("hex");
        expect(path).toContain(hash.slice(0, 12));
        expect(bytes.byteLength).toBeLessThan(1_000_000);
        expect(
          provenance.assets.find((asset) => path.endsWith(asset.file))?.sha256,
        ).toBe(hash);
      }
    }
  });
  it("keeps both location anchors and distinct counter recordings", () => {
    expect(manifest.map.anchors.map((anchor) => anchor.siteId).sort()).toEqual([
      "heights",
      "montrose",
    ]);
    expect(manifest.counters.current.counterCount).toBe(1);
    expect(manifest.counters.proposed.counterCount).toBe(2);
    expect(manifest.counters.current.poster).not.toBe(
      manifest.counters.proposed.poster,
    );
    expect(manifest.counters.current.mp4).not.toBe(
      manifest.counters.proposed.mp4,
    );
  });
});
