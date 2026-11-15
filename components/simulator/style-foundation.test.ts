import { readFileSync, readdirSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const roots = ["simulator", "site", "insights", "map", "city", "nessie"];
const files = roots.flatMap((folder) =>
  readdirSync(resolve("components", folder))
    .filter((name) => name.endsWith(".tsx"))
    .map((name) => resolve("components", folder, name)),
);
files.push(
  resolve("components/ConsultantPanel.tsx"),
  resolve("components/interior/layout-scene.tsx"),
  resolve("components/interior/matterport-scene.ts"),
  resolve("components/simulator/day-cycle.ts"),
  ...["matterport-view.tsx", "interior-view.tsx", "pick-anchor-panel.tsx"].map(
    (name) => resolve("components/interior", name),
  ),
);
describe("Stage 2 view styles", () => {
  it.each(files.map((file) => [file.replace(process.cwd() + "/", ""), file]))(
    "%s uses canonical UI surface and focus tokens",
    (_, file) => {
      const source = readFileSync(file, "utf8");
      expect(
        source.match(
          /\b(?:bg|text|border|outline|ring|accent|decoration)-(?:paper|pine|on-pine|mint|viewport-[\w-]+|emerald-[\w/.-]+|green-[\w/.-]+)\b/g,
        ),
      ).toBeNull();
    },
  );
  it.each(files.map((file) => [file.replace(process.cwd() + "/", ""), file]))(
    "%s keeps UI colors in the shared token foundation",
    (_, file) => {
      const source = readFileSync(file, "utf8")
        .split("\n")
        .filter(
          (line) => !/^\s*const (?:nightSky|daySky|twilightSky) =/.test(line),
        )
        .join("\n");
      expect(source.match(/#[\da-f]{3,8}(?![\w-])/gi)).toBeNull();
    },
  );
});
