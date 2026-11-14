import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import ts from "typescript";
import { expect, test, type Page } from "@playwright/test";

/**
 * HAC-139: the agent's interior camera bridge against a mocked Showcase SDK.
 * The real `components/interior/camera.ts` runs in the browser; only the SDK is fake.
 * Founder input is real pointer input on the mocked viewer, which stands in for
 * Matterport's `mp.input` drag events.
 */
const origin = "http://camera.test";
const modules: Record<string, string> = {
  "camera.js": "components/interior/camera.ts",
  "scan-layout.js": "components/interior/scan-layout.ts",
};

function browserModule(file: string) {
  const source = readFileSync(resolve(file), "utf8");
  return ts
    .transpileModule(source, {
      compilerOptions: {
        module: ts.ModuleKind.ESNext,
        target: ts.ScriptTarget.ES2022,
        verbatimModuleSyntax: false,
      },
    })
    .outputText.replace(/from "\.\/([\w-]+)"/g, 'from "./$1.js"');
}

const harness = `<!doctype html>
<html><body>
<div id="viewer" style="width:400px;height:300px;background:#123"></div>
<script type="module">
  import { CameraController, connectMatterportCamera } from "./camera.js";
  const viewer = document.getElementById("viewer");
  const log = [];
  const releases = [];
  const inputs = {};
  const pending = (label) => {
    log.push(label);
    return new Promise((done) => releases.push(done));
  };
  const sdk = {
    Sweep: {
      Transition: { INSTANT: "transition.instant", FLY: "transition.fly" },
      moveTo: (id, options) => pending("sweep:" + id + ":" + options.transition),
      current: { subscribe: (cb) => (cb({ sid: "a" }), { cancel() {} }) },
      data: {
        subscribe: (observer) => (
          observer.onCollectionUpdated({
            a: { sid: "a", position: { x: 0, y: 0, z: 0 }, neighbors: ["b"] },
            b: { sid: "b", position: { x: 4, y: 0, z: 0 }, neighbors: ["a"] },
          }),
          { cancel() {} }
        ),
      },
    },
    Camera: { lookAt: (_position, options) => pending("lookAt:" + options.moveToClosestSweep) },
    Mode: {
      Mode: { INSIDE: "mode.inside", DOLLHOUSE: "mode.dollhouse", FLOORPLAN: "mode.floorplan" },
      TransitionType: { INSTANT: "transition.instant", FLY: "transition.fly" },
      moveTo: (mode, options) => pending("mode:" + mode + ":" + options.transition),
      current: { subscribe: (cb) => (cb("mode.inside"), { cancel() {} }) },
    },
    Scene: {
      createObjects: async () => [{
        addNode: () => ({
          addComponent: (name, initial) => {
            Object.assign(inputs, initial);
            return {
              inputs,
              spyOnEvent({ eventType, onEvent }) {
                if (eventType !== "INPUT.DRAG") return { cancel() {} };
                let down = false;
                const start = () => (down = true);
                const move = () => down && onEvent();
                const end = () => (down = false);
                viewer.addEventListener("pointerdown", start);
                viewer.addEventListener("pointermove", move);
                window.addEventListener("pointerup", end);
                return { cancel() {} };
              },
            };
          },
        }),
        start() {},
        stop() {},
      }],
    },
  };
  const bridge = connectMatterportCamera(sdk, {
    seek: (minute) => log.push("seek:" + minute),
    onFounderInput: () => camera.founderInput(),
  });
  const motion = matchMedia("(prefers-reduced-motion: reduce)");
  const camera = new CameraController(bridge.port, {
    targets: () => ({ stations: [{ x: 3.6, y: 1, z: 0 }], agents: new Map() }),
    reducedMotion: () => motion.matches,
  });
  window.cameraTest = {
    log,
    outcomes: [],
    navigationEnabled: () => inputs.userNavigationEnabled,
    run(command) {
      camera.run(command).then((outcome) => this.outcomes.push(outcome));
    },
    release: () => releases.shift()?.(),
  };
  document.body.dataset.ready = "true";
</script>
</body></html>`;

async function open(page: Page) {
  await page.route(`${origin}/**`, (route) => {
    const name = new URL(route.request().url()).pathname.slice(1);
    if (name in modules)
      return route.fulfill({
        contentType: "text/javascript",
        body: browserModule(modules[name]),
      });
    return route.fulfill({ contentType: "text/html", body: harness });
  });
  await page.goto(`${origin}/`);
  await expect(page.locator("body")).toHaveAttribute("data-ready", "true");
  await expect
    .poll(() => page.evaluate(() => window.cameraTest.navigationEnabled()))
    .toBe(true);
}

declare global {
  interface Window {
    cameraTest: {
      log: string[];
      outcomes: string[];
      navigationEnabled(): boolean | undefined;
      run(command: unknown): void;
      release(): void;
    };
  }
}

test("a founder drag cancels the agent's pending camera moves and unlocks navigation", async ({
  page,
}) => {
  await open(page);
  await page.evaluate(() => {
    window.cameraTest.run({ type: "gotoSweep", sweepId: "b" });
    window.cameraTest.run({ type: "lookAtStation", station: 0 });
    window.cameraTest.run({ type: "seek", minute: 600 });
  });
  await expect
    .poll(() => page.evaluate(() => window.cameraTest.log))
    .toEqual(["sweep:b:transition.fly"]);
  // The agent is driving: founder navigation is locked.
  expect(await page.evaluate(() => window.cameraTest.navigationEnabled())).toBe(
    false,
  );

  const viewer = page.locator("#viewer");
  const box = (await viewer.boundingBox())!;
  await page.mouse.move(box.x + 100, box.y + 100);
  await page.mouse.down();
  await page.mouse.move(box.x + 180, box.y + 140, { steps: 4 });
  await page.mouse.up();

  await expect
    .poll(() => page.evaluate(() => window.cameraTest.outcomes))
    .toEqual(["cancelled", "cancelled", "cancelled"]);
  expect(await page.evaluate(() => window.cameraTest.navigationEnabled())).toBe(
    true,
  );
  // The in-flight transition settles, but the queued lookAt and seek never run.
  await page.evaluate(() => window.cameraTest.release());
  await page.waitForTimeout(100);
  expect(await page.evaluate(() => window.cameraTest.log)).toEqual([
    "sweep:b:transition.fly",
  ]);
});

test("reduced motion makes every agent transition instant", async ({
  page,
}) => {
  await page.emulateMedia({ reducedMotion: "reduce" });
  await open(page);
  await page.evaluate(() => {
    window.cameraTest.run({ type: "setMode", mode: "dollhouse" });
    window.cameraTest.run({ type: "lookAtStation", station: 0 });
  });
  await expect
    .poll(() => page.evaluate(() => window.cameraTest.log))
    .toEqual(["mode:mode.dollhouse:transition.instant"]);
  await page.evaluate(() => window.cameraTest.release());
  // Inside a scan, lookAt would animate its own sweep move; it jumps first instead.
  await expect
    .poll(() => page.evaluate(() => window.cameraTest.log))
    .toEqual([
      "mode:mode.dollhouse:transition.instant",
      "sweep:b:transition.instant",
    ]);
  await page.evaluate(() => window.cameraTest.release());
  await expect
    .poll(() => page.evaluate(() => window.cameraTest.log.at(-1)))
    .toBe("lookAt:false");
  await page.evaluate(() => window.cameraTest.release());
  await expect
    .poll(() => page.evaluate(() => window.cameraTest.outcomes))
    .toEqual(["done", "done"]);
  expect(await page.evaluate(() => window.cameraTest.navigationEnabled())).toBe(
    true,
  );
});
