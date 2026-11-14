import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { expect, it } from "vitest";
import { loadMatterport, normalizeMatterportManifest } from "./load-matterport";

const source = {
  origin: "default",
  provider: "modeled",
  mode: "synthetic",
  scope: "demo",
  description: "Invented mapping",
  limitations: ["Not a recorded scan"],
};
const row = {
  modelId: "Synthetic01",
  costarPropertyId: "56",
  costarSpaceId: "12:34",
  hasExterior: null,
  source,
};
const manifest = (models: unknown[]) => ({ version: 1, models });

it("deduplicates exact mappings without collapsing property and space associations", () => {
  const rows = normalizeMatterportManifest(
    manifest([row, row, { ...row, costarSpaceId: null }]),
  );
  expect(rows).toHaveLength(2);
  expect(new Set(rows.map((r) => r.id)).size).toBe(2);
  expect(rows.every((r) => r.displayApproved === false)).toBe(true);
  expect(normalizeMatterportManifest(manifest([row, row]))).toEqual(
    normalizeMatterportManifest(manifest([row])),
  );
});

it("rejects conflicting duplicate mappings, malformed IDs and secret fields", () => {
  expect(() =>
    normalizeMatterportManifest(manifest([row, { ...row, hasExterior: true }])),
  ).toThrow();
  expect(() =>
    normalizeMatterportManifest(manifest([{ ...row, costarSpaceId: "34" }])),
  ).toThrow();
  expect(() =>
    normalizeMatterportManifest(manifest([{ ...row, apiToken: "private" }])),
  ).toThrow();
  expect(() =>
    normalizeMatterportManifest(manifest([{ ...row, displayApproved: true }])),
  ).toThrow();
});

it("reports repeatable aggregate counts offline without printing source rows", async () => {
  const directory = await mkdtemp(join(tmpdir(), "matterport-test-"));
  try {
    const file = join(directory, "synthetic.json");
    await writeFile(
      file,
      JSON.stringify(manifest([row, row, { ...row, costarSpaceId: null }])),
    );
    const result = await loadMatterport(file);
    expect(result).toEqual({
      mode: "report-only",
      mappings: 2,
      models: 1,
      cachedDimensions: 0,
    });
    expect(await loadMatterport(file)).toEqual(result);
    expect(JSON.stringify(result)).not.toMatch(/Synthetic01|Invented/);
    expect(await readFile(file, "utf8")).toContain("Synthetic01");
  } finally {
    await rm(directory, { recursive: true });
  }
});
