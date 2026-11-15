import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import type { Page } from "@playwright/test";
import { expect, test } from "./fixtures";

// HAC-140: the real React viewer against a same-origin stand-in for the Bundle
// SDK. No request reaches Matterport: the SDK page, Three.js and the public
// embed are all fulfilled locally. The scanned view only renders when the
// server has MATTERPORT_SDK_KEY, so without one these specs skip.

const three = (file: string) =>
  readFileSync(resolve("node_modules/three/build", file), "utf8");

/** A Showcase double that records every resource in the parent window. */
function showcaseStub(mode: "ok" | "key-refused") {
  return `<!doctype html><html><body><script type="module">
import * as THREE from "./three.module.js";
const counts = (window.top.__mp ??= {
  connections: 0, disconnects: 0, subscriptions: 0, cancels: 0,
  registrations: 0, unregisters: 0, started: 0, stopped: 0,
});
const factories = new Map();
const sdk = {
  disconnect() { counts.disconnects++; },
  App: {
    Phase: { PLAYING: "playing" },
    state: {
      subscribe(callback) {
        counts.subscriptions++;
        let live = true;
        setTimeout(() => live && callback({ phase: "playing" }), 50);
        return { cancel() { if (live) { live = false; counts.cancels++; } } };
      },
    },
  },
  Sweep: { moveTo: async () => {}, Transition: { INSTANT: "instant" } },
  Scene: {
    async register(name, factory) {
      counts.registrations++;
      factories.set(name, factory);
      return { dispose() { if (factories.delete(name)) counts.unregisters++; } };
    },
    async createObjects() {
      let component;
      let state = "new";
      const scene = new THREE.Scene();
      return [{
        addNode: () => ({
          addComponent(name, inputs) {
            component = factories.get(name)();
            Object.assign(component.outputs, { objectRoot: null, collider: null });
            component.context = { three: THREE };
            Object.assign(component.inputs, inputs);
            return component;
          },
        }),
        async start() {
          if (state !== "new") throw new Error("Scene object reused");
          state = "started";
          counts.started++;
          component.onInit();
          scene.add(component.outputs.objectRoot);
        },
        stop() {
          if (state !== "started") throw new Error("Scene object not running");
          state = "stopped";
          counts.stopped++;
          component.onDestroy();
        },
      }];
    },
  },
};
window.MP_SDK = {
  async connect() {
    ${
      mode === "key-refused"
        ? 'throw new Error("Application key is not authorized for this domain");'
        : "counts.connections++; return sdk;"
    }
  },
};
</script></body></html>`;
}

async function stubMatterport(
  page: Page,
  showcase: "ok" | "key-refused" | "missing",
) {
  await page.route("**/api/vexcel/**", (route) => route.abort());
  await page.route("https://my.matterport.com/**", (route) =>
    route.fulfill({
      contentType: "text/html",
      body: "<!doctype html><title>Public embed stub</title><p>Public embed stub</p>",
    }),
  );
  for (const file of ["three.module.js", "three.core.js"])
    await page.route(`**/matterport/${file}`, (route) =>
      route.fulfill({ contentType: "text/javascript", body: three(file) }),
    );
  await page.route(/\/matterport\/showcase\.html(?:\?|$)/, (route) =>
    showcase === "missing"
      ? route.fulfill({ status: 404, contentType: "text/html", body: "404" })
      : route.fulfill({
          contentType: "text/html",
          body: showcaseStub(showcase),
        }),
  );
}

async function openScan(page: Page) {
  await page.goto("/projects/houston-coffee/simulator#scanned-interior");
  const scanButton = page.getByRole("button", {
    name: "Scanned interior",
    exact: true,
  });
  test.skip(
    await scanButton.isDisabled(),
    "Scanned interior needs MATTERPORT_SDK_KEY on the server",
  );
  const scan = page.locator('[aria-label="Scanned simulation"]');
  await scan.scrollIntoViewIfNeeded();
  return { scan, scanButton };
}

test("mounts and unmounts the scanned viewer 10 times without leaking SDK resources", async ({
  page,
}) => {
  test.setTimeout(90_000);
  await stubMatterport(page, "ok");
  const { scan, scanButton } = await openScan(page);
  const modeled = page.getByRole("button", {
    name: "Modeled layout",
    exact: true,
  });
  const counts = () =>
    page.evaluate(
      () => (window as unknown as { __mp: Record<string, number> }).__mp,
    );
  for (let cycle = 0; cycle < 10; cycle++) {
    if (cycle > 0) {
      await scanButton.click();
      await scan.scrollIntoViewIfNeeded();
    }
    await expect(scan.locator('[data-overlay-status="ready"]')).toBeVisible();
    await modeled.click();
    await expect(scan).toHaveCount(0);
    const now = await counts();
    expect(now.connections, `cycle ${cycle + 1}`).toBe(cycle + 1);
    expect(now.disconnects).toBe(now.connections);
    expect(now.cancels).toBe(now.subscriptions);
    expect(now.unregisters).toBe(now.registrations);
    expect(now.stopped).toBe(now.started);
  }
});

test("falls back to the labelled public embed when the SDK bundle is missing, and retries", async ({
  page,
}) => {
  await stubMatterport(page, "missing");
  const { scan } = await openScan(page);
  const status = scan.getByRole("status");
  await expect(status).toHaveAttribute("data-viewer-failure", "bundle");
  await expect(status).toContainText("plain public embed");
  const embed = scan.getByTitle(
    "Matterport café interior (plain public embed)",
  );
  await expect(embed).toHaveAttribute(
    "src",
    /^https:\/\/my\.matterport\.com\/show\?m=[^&]+&play=1&qs=1$/,
  );
  await expect(
    page
      .frameLocator('iframe[title$="(plain public embed)"]')
      .getByText("Public embed stub"),
  ).toBeVisible();
  await scan.getByRole("button", { name: "Retry scanned interior" }).click();
  await expect(status).toHaveAttribute("data-viewer-failure", "bundle");
  await expect(embed).toBeVisible();
});

test("labels a refused SDK key and still shows the scan", async ({ page }) => {
  await stubMatterport(page, "key-refused");
  const { scan } = await openScan(page);
  const status = scan.getByRole("status");
  await expect(status).toHaveAttribute("data-viewer-failure", "key");
  await expect(status).toContainText("SDK key was refused");
  await expect(
    scan.getByTitle("Matterport café interior (plain public embed)"),
  ).toBeVisible();
});
