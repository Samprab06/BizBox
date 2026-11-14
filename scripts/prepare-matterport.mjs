import { createHash } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { resolve, join } from "node:path";
import { execFileSync } from "node:child_process";
import { parse } from "dotenv";

// Use the unmodified, self-contained Bundle SDK distributed by Matterport. Its
// iframe owns Three.js 0.184; the application's Three.js version stays unchanged.
const version = "0.1.47";
const integrity =
  "rIwtHRHMBmFddoeF4A9dpdPnRvXZ736H77YFx3CdkVRCJkqUoxWoZW8lddCLdNF0CC0U8wyVSjX/J7UJUOIvDg==";
const destination = resolve("public/matterport");
const marker = join(destination, ".sdk-version");
const local = existsSync(".env.local") ? parse(readFileSync(".env.local")) : {};
const configured = Boolean(
  (process.env.MATTERPORT_SDK_KEY ?? local.MATTERPORT_SDK_KEY)?.trim(),
);

if (configured || process.argv.includes("--required")) {
  if (!existsSync(marker) || (await readFile(marker, "utf8")) !== version) {
    const temporary = await mkdtemp(join(tmpdir(), "bizbox-matterport-"));
    try {
      const response = await fetch(
        `https://registry.npmjs.org/@matterport/webcomponent/-/webcomponent-${version}.tgz`,
      );
      if (!response.ok) throw new Error("Matterport SDK asset download failed");
      const archive = Buffer.from(await response.arrayBuffer());
      if (createHash("sha512").update(archive).digest("base64") !== integrity) {
        throw new Error(
          "Matterport SDK archive integrity did not match the pinned release",
        );
      }
      const file = join(temporary, "sdk.tgz");
      await writeFile(file, archive);
      await mkdir(destination, { recursive: true });
      execFileSync("tar", [
        "-xzf",
        file,
        "--strip-components=2",
        "-C",
        destination,
        "package/built-bundle",
      ]);
      await writeFile(marker, version);
      console.log(`Prepared Matterport Bundle SDK assets (${version})`);
    } finally {
      await rm(temporary, { recursive: true, force: true });
    }
  }
}
