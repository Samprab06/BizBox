/** Build-time only: a bounded, checksummed CC0 furniture snapshot. Never a runtime fetch. */
import { createHash } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { Box3, Matrix4, Quaternion, Vector3 } from "three";
import { z } from "zod";

const ROOT = fileURLToPath(new URL("../", import.meta.url));
const MAX_FILE_BYTES = 8 * 1024 * 1024;
const MAX_TOTAL_BYTES = 24 * 1024 * 1024;
const HEADERS = { "User-Agent": "BizBox-AssetPreparation/1.0" };
const selection = [
  { id: "round_wooden_table_02", role: "table", seats: 0 },
  { id: "painted_wooden_chair_01", role: "seating", seats: 1 },
  { id: "painted_wooden_stool", role: "seating", seats: 1 },
  { id: "wooden_display_shelves_01", role: "storage", seats: 0 },
] as const;
const vec = z.tuple([
  z.number().finite(),
  z.number().finite(),
  z.number().finite(),
]);
const gltfSchema = z.object({
  asset: z.object({ version: z.literal("2.0") }),
  scene: z.number().int().nonnegative().default(0),
  scenes: z
    .array(z.object({ nodes: z.array(z.number().int().nonnegative()) }))
    .max(100),
  nodes: z
    .array(
      z.object({
        mesh: z.number().int().nonnegative().optional(),
        children: z.array(z.number().int().nonnegative()).optional(),
        translation: vec.optional(),
        scale: vec.optional(),
        rotation: z
          .tuple([z.number(), z.number(), z.number(), z.number()])
          .optional(),
        matrix: z.array(z.number().finite()).length(16).optional(),
      }),
    )
    .max(10000),
  meshes: z.array(
    z.object({
      primitives: z.array(
        z.object({
          attributes: z.object({ POSITION: z.number().int().nonnegative() }),
        }),
      ),
    }),
  ),
  accessors: z.array(
    z.object({ type: z.string(), min: vec.optional(), max: vec.optional() }),
  ),
});
const rounded = (value: number) => Math.round(value * 1e8) / 1e8;
export function gltfModelBounds(input: unknown) {
  const model = gltfSchema.parse(input),
    box = new Box3();
  const ancestors = new Set<number>();
  function visit(id: number, parent: Matrix4) {
    if (ancestors.has(id)) throw new Error("Cyclic glTF scene");
    const node = model.nodes[id];
    if (!node) throw new Error("Unknown glTF node");
    ancestors.add(id);
    const local = node.matrix
      ? new Matrix4().fromArray(node.matrix)
      : new Matrix4().compose(
          new Vector3().fromArray(node.translation ?? [0, 0, 0]),
          new Quaternion().fromArray(node.rotation ?? [0, 0, 0, 1]),
          new Vector3().fromArray(node.scale ?? [1, 1, 1]),
        );
    const world = parent.clone().multiply(local);
    if (node.mesh !== undefined) {
      const mesh = model.meshes[node.mesh];
      if (!mesh) throw new Error("Unknown glTF mesh");
      for (const primitive of mesh.primitives) {
        const a = model.accessors[primitive.attributes.POSITION];
        if (
          !a?.min ||
          !a.max ||
          a.type !== "VEC3" ||
          a.min.some((v, i) => v > a.max![i])
        )
          throw new Error("Missing glTF position bounds");
        box.union(
          new Box3(
            new Vector3().fromArray(a.min),
            new Vector3().fromArray(a.max),
          ).applyMatrix4(world),
        );
      }
    }
    for (const child of node.children ?? []) visit(child, world);
    ancestors.delete(id);
  }
  const scene = model.scenes[model.scene];
  if (!scene) throw new Error("Missing default glTF scene");
  for (const id of scene.nodes) visit(id, new Matrix4());
  const size = box.getSize(new Vector3()),
    center = box.getCenter(new Vector3());
  if (
    box.isEmpty() ||
    [size.x, size.y, size.z].some(
      (n) => !Number.isFinite(n) || n <= 0 || n > 20,
    )
  )
    throw new Error("Unsupported glTF dimensions");
  return {
    widthM: rounded(size.x),
    depthM: rounded(size.z),
    heightM: rounded(size.y),
    modelOffsetM: [
      rounded(-center.x),
      rounded(-box.min.y),
      rounded(-center.z),
    ] as [number, number, number],
  };
}
/** Metadata uses Blender XYZ millimetres; glTF uses Y-up metres. Some exports bake a 90° yaw. */
export function validateMetadataDimensions(
  sourceMm: readonly number[],
  actual: { widthM: number; depthM: number; heightM: number },
) {
  const same = (a: number, b: number) =>
    Math.abs(a - b) <= Math.max(0.01, Math.abs(b) * 0.02);
  const [width, depth, height] = sourceMm.map((v) => v / 1000);
  if (!same(actual.heightM, height))
    throw new Error("Source metadata/glTF height disagrees");
  if (same(actual.widthM, width) && same(actual.depthM, depth))
    return "direct" as const;
  if (same(actual.widthM, depth) && same(actual.depthM, width))
    return "swapped-in-gltf" as const;
  throw new Error("Source metadata/glTF footprint disagrees");
}
export function safeDependencyPath(path: string): string {
  if (
    !/^[a-zA-Z0-9_./-]+$/.test(path) ||
    path.startsWith("/") ||
    path.split("/").some((p) => !p || p === "." || p === "..")
  )
    throw new Error("Unsafe asset dependency path");
  return path;
}
const downloadSchema = z.object({
  url: z.string().url(),
  size: z.number().int().positive().max(MAX_FILE_BYTES),
  md5: z.string().regex(/^[a-f0-9]{32}$/),
  include: z
    .record(
      z.string(),
      z.object({
        url: z.string().url(),
        size: z.number().int().positive().max(MAX_FILE_BYTES),
        md5: z.string().regex(/^[a-f0-9]{32}$/),
      }),
    )
    .optional(),
});
export function verifyDownload(
  bytes: Buffer,
  expected: { size: number; md5: string },
) {
  if (
    bytes.length !== expected.size ||
    createHash("md5").update(bytes).digest("hex") !== expected.md5
  )
    throw new Error("Source asset checksum or size mismatch");
}
function approvedUrl(value: string) {
  const url = new URL(value);
  if (
    url.protocol !== "https:" ||
    url.username ||
    url.password ||
    !["api.polyhaven.com", "dl.polyhaven.org"].includes(url.hostname)
  )
    throw new Error("Unapproved furniture source URL");
  return url;
}
async function fetchBytes(url: string) {
  const response = await fetch(approvedUrl(url), {
    headers: HEADERS,
    redirect: "error",
    signal: AbortSignal.timeout(30000),
  });
  if (!response.ok || !response.body)
    throw new Error(`Furniture source returned ${response.status}`);
  const reader = response.body.getReader();
  const chunks: Buffer[] = [];
  let size = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > MAX_FILE_BYTES) {
        await reader.cancel();
        throw new Error("Furniture source exceeds file limit");
      }
      chunks.push(Buffer.from(value));
    }
  } finally {
    reader.releaseLock();
  }
  return Buffer.concat(chunks);
}
export async function prepareFurnitureCatalog(root = ROOT) {
  const raw = JSON.parse(
    (
      await fetchBytes(
        "https://api.polyhaven.com/assets?type=models&category=furniture",
      )
    ).toString(),
  );
  const metadata = z
    .record(
      z.string(),
      z.object({
        name: z.string(),
        dimensions: z.array(z.number().positive()).length(3),
        polycount: z.number().int().nonnegative().optional(),
      }),
    )
    .parse(raw);
  const items = [];
  const files = [];
  let total = 0;
  for (const selected of selection) {
    const meta = metadata[selected.id];
    if (!meta) throw new Error("Selected furniture missing from source");
    const fileMap = JSON.parse(
      (
        await fetchBytes(`https://api.polyhaven.com/files/${selected.id}`)
      ).toString(),
    );
    const entry = downloadSchema.parse(fileMap.gltf?.["1k"]?.gltf);
    const resources = [
      [`${selected.id}_1k.gltf`, entry],
      ...Object.entries(entry.include ?? {}),
    ] as const;
    if (
      resources.reduce((sum, [, file]) => sum + file.size, total) >
      MAX_TOTAL_BYTES
    )
      throw new Error("Furniture snapshot exceeds total limit");
    let gltf: Record<string, unknown> | undefined;
    const available = new Set(
      resources.map(([name]) => safeDependencyPath(name)),
    );
    for (const [name, file] of resources) {
      const relative = safeDependencyPath(name),
        destination = resolve(root, "public/furniture", selected.id, relative);
      let bytes: Buffer;
      try {
        bytes = await readFile(destination);
        verifyDownload(bytes, file);
      } catch {
        bytes = await fetchBytes(file.url);
        verifyDownload(bytes, file);
      }
      total += bytes.length;
      if (relative.endsWith(".gltf")) {
        gltf = JSON.parse(bytes.toString()) as Record<string, unknown>;
        for (const dependency of [
          ...((gltf.buffers as { uri?: string }[]) ?? []),
          ...((gltf.images as { uri?: string }[]) ?? []),
        ])
          if (
            dependency.uri &&
            !available.has(safeDependencyPath(dependency.uri))
          )
            throw new Error("Unmapped glTF resource");
      }
      await mkdir(dirname(destination), { recursive: true });
      await writeFile(destination, bytes);
      files.push({
        path: `/furniture/${selected.id}/${relative}`,
        sourceUrl: file.url,
        bytes: bytes.length,
        sha256: createHash("sha256").update(bytes).digest("hex"),
        sourceMd5: file.md5,
      });
    }
    const bounds = gltfModelBounds(gltf);
    const sourceFootprintAxes = validateMetadataDimensions(
      meta.dimensions,
      bounds,
    );
    items.push({
      ...selected,
      name: meta.name,
      provider: "poly-haven",
      license: "CC0-1.0",
      sourceUrl: `https://polyhaven.com/a/${selected.id}`,
      assetUrl: `/furniture/${selected.id}/${selected.id}_1k.gltf`,
      ...bounds,
      dimensionsStatus: "source-model-bounds",
      sourceFootprintAxes,
      sourceDimensionsMm: meta.dimensions,
      polycount: meta.polycount ?? null,
    });
  }
  await mkdir(resolve(root, "lib/furniture"), { recursive: true });
  await writeFile(
    resolve(root, "lib/furniture/catalog-data.json"),
    JSON.stringify(items, null, 2) + "\n",
  );
  await writeFile(
    resolve(root, "public/furniture/manifest.json"),
    JSON.stringify(
      {
        version: 1,
        retrievedAt: new Date().toISOString(),
        provider: "Poly Haven",
        licenseUrl: "https://polyhaven.com/license",
        apiTermsUrl: "https://polyhaven.com/our-api",
        coordinateUnit: "meters",
        upAxis: "y",
        totalBytes: total,
        files,
      },
      null,
      2,
    ) + "\n",
  );
  return {
    itemCount: items.length,
    fileCount: files.length,
    totalBytes: total,
  };
}
if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(resolve(process.argv[1])).href
) {
  prepareFurnitureCatalog()
    .then((result) => console.log(JSON.stringify(result)))
    .catch(() => {
      console.error(
        "Furniture preparation failed; no runtime catalog activation is implied.",
      );
      process.exitCode = 1;
    });
}
