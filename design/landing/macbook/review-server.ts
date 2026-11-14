/** Local asset inspection only. Not imported by the Next.js application. */
import { createServer } from "node:http";
import { createReadStream } from "node:fs";
import { stat } from "node:fs/promises";
import { dirname, extname, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const root = resolve(here, "../../..");
const roots = {
  "/assets/": resolve(root, "public/landing-assets/macbook"),
  "/three/": resolve(root, "node_modules/three"),
};
const mime: Record<string, string> = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".json": "application/json",
  ".glb": "model/gltf-binary",
  ".png": "image/png",
  ".jpg": "image/jpeg",
};
const server = createServer(async (request, response) => {
  try {
    const pathname = decodeURIComponent(
      new URL(request.url ?? "/", "http://local").pathname,
    );
    if (pathname === "/workspace-config.json") {
      const origin =
        process.env.BIZBOX_REVIEW_PRODUCT_ORIGIN ?? "http://127.0.0.1:4194";
      const url = new URL("/landing-workspace", origin);
      if (!["http:", "https:"].includes(url.protocol))
        throw new Error("Invalid product origin");
      response.writeHead(200, { "Content-Type": "application/json" });
      response.end(JSON.stringify({ workspaceUrl: url.href }));
      return;
    }
    let file =
      pathname === "/"
        ? resolve(here, "review.html")
        : pathname === "/review.js" || pathname === "/screen-transform.js"
          ? resolve(here, pathname.slice(1))
          : undefined;
    for (const [prefix, directory] of Object.entries(roots)) {
      if (!pathname.startsWith(prefix)) continue;
      const candidate = resolve(directory, pathname.slice(prefix.length));
      if (candidate.startsWith(directory + sep)) file = candidate;
    }
    if (!file || !(await stat(file)).isFile()) {
      response.writeHead(404).end();
      return;
    }
    response.writeHead(200, {
      "Content-Type": mime[extname(file)] ?? "application/octet-stream",
    });
    createReadStream(file).pipe(response);
  } catch {
    response.writeHead(404).end();
  }
});
server.listen(4193, "127.0.0.1", () =>
  console.log("MacBook review: http://127.0.0.1:4193"),
);
