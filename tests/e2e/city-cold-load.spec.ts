import { test, expect, type Page, type Route } from "@playwright/test";

// HAC-177: the 3D neighborhood reports real cold-load stages and resolves.
// Vexcel is stubbed with one small glTF tile, and each response is delayed so
// every stage is observable. Run against a local server started with a dummy
// VEXCEL_API_KEY (the key only enables the city branch; no request leaves).

const MONTROSE = { longitude: -95.3914, latitude: 29.7458 };

/** Column-major east-north-up frame at the site, for the tile transform. */
function eastNorthUp({ longitude, latitude }: typeof MONTROSE) {
  const a = 6378137;
  const e2 = 6.69437999014e-3;
  const lon = (longitude * Math.PI) / 180;
  const lat = (latitude * Math.PI) / 180;
  const n = a / Math.sqrt(1 - e2 * Math.sin(lat) ** 2);
  const [x, y, z] = [
    n * Math.cos(lat) * Math.cos(lon),
    n * Math.cos(lat) * Math.sin(lon),
    n * (1 - e2) * Math.sin(lat),
  ];
  return [
    -Math.sin(lon),
    Math.cos(lon),
    0,
    0,
    -Math.sin(lat) * Math.cos(lon),
    -Math.sin(lat) * Math.sin(lon),
    Math.cos(lat),
    0,
    Math.cos(lat) * Math.cos(lon),
    Math.cos(lat) * Math.sin(lon),
    Math.sin(lat),
    0,
    x,
    y,
    z,
    1,
  ];
}

const tileset = {
  asset: { version: "1.1" },
  geometricError: 500,
  root: {
    transform: eastNorthUp(MONTROSE),
    boundingVolume: { sphere: [0, 0, 0, 500] },
    geometricError: 0,
    refine: "REPLACE",
    content: { uri: "tile.gltf" },
  },
};

/** A ground square and one upright triangle (glTF is y-up). */
function gltf() {
  const positions = new Float32Array([
    -300, 0, -300, 300, 0, -300, 300, 0, 300, -300, 0, -300, 300, 0, 300, -300,
    0, 300, -100, 0, 0, 100, 0, 0, 0, 120, 0,
  ]);
  const bytes = Buffer.from(positions.buffer);
  return {
    asset: { version: "2.0" },
    scene: 0,
    scenes: [{ nodes: [0] }],
    nodes: [{ mesh: 0 }],
    meshes: [{ primitives: [{ attributes: { POSITION: 0 }, material: 0 }] }],
    materials: [
      {
        doubleSided: true,
        pbrMetallicRoughness: { baseColorFactor: [0.8, 0.8, 0.8, 1] },
      },
    ],
    buffers: [
      {
        byteLength: bytes.length,
        uri: `data:application/octet-stream;base64,${bytes.toString("base64")}`,
      },
    ],
    bufferViews: [
      { buffer: 0, byteOffset: 0, byteLength: bytes.length, target: 34962 },
    ],
    accessors: [
      {
        bufferView: 0,
        componentType: 5126,
        count: 9,
        type: "VEC3",
        min: [-300, 0, -300],
        max: [300, 120, 300],
      },
    ],
  };
}

const delay = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

async function stubImagery(page: Page, { holdTileset = false } = {}) {
  await page.route("https://tiles.openfreemap.org/**", (route) =>
    route.abort(),
  );
  const held: Route[] = [];
  await page.route("**/api/vexcel/3d/tileset*", async (route) => {
    if (holdTileset) {
      held.push(route);
      return;
    }
    await delay(1500);
    await route.fulfill({ json: tileset });
  });
  await page.route("**/api/vexcel/3d/tile.gltf*", async (route) => {
    await delay(1500);
    await route.fulfill({ json: gltf() });
  });
  return held;
}

async function openCity(page: Page) {
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto("/projects/houston-coffee/simulator");
  const city = page.locator("#neighborhood");
  await city.scrollIntoViewIfNeeded();
  return city;
}

test.beforeEach(({ isMobile }) => {
  test.skip(
    process.env.E2E_SIMULATOR_CITY !== "1",
    "Run against a local server with a dummy VEXCEL_API_KEY to exercise the city branch; imagery is stubbed offline.",
  );
  test.skip(isMobile, "The 3D neighborhood cold load is a desktop check.");
});

test("cold load shows real stages, then the buildings replace the overlay", async ({
  page,
}) => {
  test.setTimeout(90_000);
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await stubImagery(page);
  const city = await openCity(page);
  const overlay = city.locator("[data-city-overlay]");
  await expect(overlay.getByRole("status")).toContainText(
    "Loading 3D neighborhood:",
  );
  await expect(overlay.getByRole("status")).toContainText(/Step \d of 4/);
  await expect(overlay.getByRole("status")).toContainText(/\d+ s/);
  await expect(overlay).not.toContainText("%");
  // The tile response is held for 1.5 s, so the streaming stage is visible.
  await expect(city).toHaveAttribute("data-city-stage", "tiles", {
    timeout: 30_000,
  });
  await expect(overlay.getByRole("status")).toContainText(
    "Streaming buildings",
  );
  await expect(city).toHaveAttribute(
    "data-city-stage",
    /^(refining|settled)$/,
    { timeout: 30_000 },
  );
  await expect(overlay).toHaveCount(0);
  await expect(city).toHaveAttribute("data-city-stage", "settled", {
    timeout: 30_000,
  });
  expect(errors).toEqual([]);
});

test("a slow cold load offers Skip, and the 3D view can be loaded again", async ({
  page,
}) => {
  test.setTimeout(90_000);
  const held = await stubImagery(page, { holdTileset: true });
  const city = await openCity(page);
  await expect(city).toHaveAttribute("data-city-stage", "imagery", {
    timeout: 30_000,
  });
  await expect(city.getByRole("status").first()).toContainText(
    "Connecting to Vexcel imagery",
  );
  const skip = city.getByRole("button", { name: "Skip 3D view" });
  await expect(skip).toBeVisible({ timeout: 15_000 });
  await skip.click();
  await expect(city).toHaveAttribute("data-city-stage", "skipped");
  await expect(
    city.getByText(
      "3D neighborhood skipped. The timeline and replay still work.",
    ),
  ).toBeVisible();
  await expect(
    page.getByLabel("Neighborhood timeline", { exact: true }),
  ).toBeVisible();
  await city.getByRole("button", { name: "Load 3D neighborhood" }).click();
  await expect(city).toHaveAttribute(
    "data-city-stage",
    /^(engine|decoders|imagery)$/,
  );
  await expect(skip).toHaveCount(0);
  await Promise.all(held.map((route) => route.abort().catch(() => {})));
});
