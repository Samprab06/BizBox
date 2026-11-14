import { cp, mkdir } from "node:fs/promises";

await mkdir("public/cesium", { recursive: true });
await Promise.all(
  ["Workers", "ThirdParty", "Assets", "Widgets"].map((directory) =>
    cp(
      `node_modules/cesium/Build/Cesium/${directory}`,
      `public/cesium/${directory}`,
      {
        recursive: true,
      },
    ),
  ),
);
