import { createHash } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { FURNITURE_CATALOG, furnitureForCategory } from "./catalog";

describe("curated furniture snapshot", () => {
  it("has local geometry and dependencies for each source-backed item", () => {
    expect(FURNITURE_CATALOG).toHaveLength(4);
    for (const item of FURNITURE_CATALOG) {
      const path = resolve("public", item.assetUrl.slice(1));
      expect(existsSync(path)).toBe(true);
      const gltf = JSON.parse(readFileSync(path, "utf8"));
      for (const dependency of [...gltf.buffers, ...gltf.images])
        expect(existsSync(resolve(path, "..", dependency.uri))).toBe(true);
      expect(item.widthM * item.depthM * item.heightM).toBeGreaterThan(0);
      expect(item.license).toBe("CC0-1.0");
      expect(item.priceUsd).toBeNull();
    }
  });
  it("ships exactly the checksummed source bytes recorded in the provenance manifest", () => {
    const manifest = JSON.parse(
      readFileSync("public/furniture/manifest.json", "utf8"),
    ) as {
      totalBytes: number;
      files: { path: string; bytes: number; sha256: string }[];
    };
    expect(manifest.files).toHaveLength(20);
    let total = 0;
    for (const file of manifest.files) {
      expect(file.path.startsWith("/furniture/")).toBe(true);
      const bytes = readFileSync(resolve("public", file.path.slice(1)));
      expect(bytes.length).toBe(file.bytes);
      expect(createHash("sha256").update(bytes).digest("hex")).toBe(
        file.sha256,
      );
      total += bytes.length;
    }
    expect(total).toBe(manifest.totalBytes);
  });
  it("makes specialty-equipment gaps explicit for every existing category", () => {
    for (const category of [
      "coffee",
      "quick_food",
      "salon_barber",
      "fitness",
    ] as const) {
      const available = furnitureForCategory(category);
      expect(available.length).toBeGreaterThan(0);
      expect(
        available.every(
          (item) => item.businessSpecificationStatus === "not-provided",
        ),
      ).toBe(true);
    }
  });
});
