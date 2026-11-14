import type { Page } from "@playwright/test";
import { views, workspaceHref, type View } from "../../lib/client/workspace-routes";
import { expect, test } from "./fixtures";

// Selection used by the nav when the page itself carries no `?site=`: the first
// example site (components/workspace-view.tsx falls back to project.sites[0]).
const DEFAULT_SITE = "montrose";
const VIEW_ORDER = Object.keys(views) as View[];

function projectNav(page: Page) {
  return page.getByRole("navigation", { name: "Project views" });
}

function navLink(page: Page, view: View) {
  return projectNav(page).getByRole("link", { name: views[view], exact: true });
}

/** Collects console errors, console warnings and uncaught page errors. */
function trackConsole(page: Page) {
  const problems: string[] = [];
  const benignWarnings = [
    /^Expected value to be of type number, but found null instead\.$/,
    /^THREE\.Clock: This module has been deprecated\./,
    /^\[\.WebGL-.*GPU stall due to ReadPixels/,
  ];
  page.on("console", (message) => {
    if (message.type() === "error" || message.type() === "warning") {
      if (message.type() === "warning" && benignWarnings.some((pattern) => pattern.test(message.text()))) {
        return;
      }
      problems.push(`${message.type()}: ${message.text()}`);
    }
  });
  page.on("pageerror", (error) => problems.push(`pageerror: ${error.message}`));
  return problems;
}

test.describe("navigation", () => {
  test("the nav reaches all five views, marks the active one and matches workspaceHref()", async ({
    page,
    gotoView,
    projectId,
  }) => {
    await gotoView("intake");
    await expect(projectNav(page).getByRole("link")).toHaveText(VIEW_ORDER.map((view) => views[view]));

    for (const view of VIEW_ORDER) {
      await navLink(page, view).click();
      const expectedHref = workspaceHref(projectId, view, DEFAULT_SITE);
      await expect(page).toHaveURL((url) => url.pathname + url.search === expectedHref);
      await expect(page.getByRole("heading", { level: 1, name: views[view] })).toBeVisible();

      // Exactly one link is current, and it is the one for this view.
      await expect(navLink(page, view)).toHaveAttribute("aria-current", "page");
      for (const other of VIEW_ORDER.filter((item) => item !== view)) {
        await expect(navLink(page, other)).not.toHaveAttribute("aria-current", /.+/);
      }
    }
  });

  test("the Sitework link in the header returns to the example project", async ({ page, gotoView, projectId }) => {
    await gotoView("replay");
    await page.getByRole("banner").getByRole("link", { name: "Sitework" }).click();
    await expect(page).toHaveURL(new RegExp(`${workspaceHref(projectId, "intake")}$`));
    await expect(page.getByRole("heading", { level: 1, name: "Intake" })).toBeVisible();
  });
});

test.describe("deep links", () => {
  for (const view of VIEW_ORDER) {
    test(`loading the ${view} URL directly renders that view`, async ({ page, gotoView }) => {
      await gotoView(view, view === "site" ? DEFAULT_SITE : undefined);

      await expect(page.getByRole("heading", { level: 1, name: views[view] })).toBeVisible();
      await expect(page.getByRole("region", { name: views[view], exact: true })).toBeVisible();
      await expect(navLink(page, view)).toHaveAttribute("aria-current", "page");
    });
  }

  test("?site=<id> is kept when moving between views that take a site", async ({ page, gotoView, projectId }) => {
    await gotoView("map", "heights");
    await expect(page).toHaveURL(/\/map\?site=heights$/);

    await navLink(page, "comparison").click();
    await expect(page).toHaveURL(workspaceHref(projectId, "comparison", "heights"));
    await expect(page.getByRole("heading", { level: 1, name: "Comparison" })).toBeVisible();

    await navLink(page, "replay").click();
    await expect(page).toHaveURL(workspaceHref(projectId, "replay", "heights"));

    await navLink(page, "site").click();
    await expect(page).toHaveURL(workspaceHref(projectId, "site", "heights"));
    await expect(page.getByRole("heading", { level: 2, name: "Heights storefront" })).toBeVisible();

    await navLink(page, "map").click();
    await expect(page).toHaveURL(workspaceHref(projectId, "map", "heights"));
    await expect(page.getByRole("heading", { level: 1, name: "Map" })).toBeVisible();
  });

  test("picking a site on the map selects it for the other views", async ({
    page,
    gotoView,
    projectId,
  }) => {
    await gotoView("map");
    const row = page
      .getByRole("list", { name: "Candidate sites", exact: true })
      .getByRole("link", { name: /Heights storefront/ });
    await row.click();
    await expect(page).toHaveURL(workspaceHref(projectId, "map", "heights"));
    await expect(row).toHaveAttribute("aria-current", "true");

    await navLink(page, "comparison").click();
    await expect(page).toHaveURL(
      workspaceHref(projectId, "comparison", "heights"),
    );
  });

  test("/sites/unselected shows a recoverable state, not an error", async ({ page, gotoView, projectId }) => {
    const problems = trackConsole(page);
    await gotoView("site");
    await expect(page).toHaveURL(/\/sites\/unselected$/);

    await expect(page.getByRole("heading", { level: 1, name: "Site detail" })).toBeVisible();
    // Not the error boundary and not a stack trace.
    await expect(page.getByRole("heading", { name: "Unable to load this project view" })).toHaveCount(0);
    await expect(page.getByText(/\bat\s+\S+\s+\(.*:\d+:\d+\)/)).toHaveCount(0);

    // There is a way to pick a site.
    await page.getByRole("link", { name: "Back to map" }).click();
    await expect(page).toHaveURL(workspaceHref(projectId, "map"));
    await expect(page.getByRole("link", { name: /Montrose storefront/ })).toBeVisible();
    expect(problems).toEqual([]);
  });

  test("/sites/unselected asks the user to pick a site", async ({ page, gotoView }) => {
    await gotoView("site");
    await expect(page.getByText(/pick a site|select a site|choose a site/i)).toBeVisible();
  });
});

test.describe("history", () => {
  test("back and forward move through the views in order", async ({ page, gotoView, projectId }) => {
    await gotoView("intake");
    const visited: View[] = ["map", "site", "comparison", "replay"];
    for (const view of visited) {
      await navLink(page, view).click();
      await expect(page.getByRole("heading", { level: 1, name: views[view] })).toBeVisible();
    }

    // The first entry was opened without a site; every nav link carries the default one.
    const trail: View[] = ["intake", ...visited];
    const pathFor = (view: View) =>
      view === "intake" ? workspaceHref(projectId, "intake") : workspaceHref(projectId, view, DEFAULT_SITE);

    for (const view of trail.slice(0, -1).reverse()) {
      await page.goBack();
      await expect(page.getByRole("heading", { level: 1, name: views[view] })).toBeVisible();
      await expect(page).toHaveURL((url) => url.pathname + url.search === pathFor(view));
      await expect(navLink(page, view)).toHaveAttribute("aria-current", "page");
    }

    for (const view of trail.slice(1)) {
      await page.goForward();
      await expect(page.getByRole("heading", { level: 1, name: views[view] })).toBeVisible();
      await expect(page).toHaveURL((url) => url.pathname + url.search === pathFor(view));
      await expect(navLink(page, view)).toHaveAttribute("aria-current", "page");
    }
  });
});

test.describe("bad input", () => {
  for (const view of VIEW_ORDER) {
    test(`an unknown projectId on the ${view} view shows a way back`, async ({ page }) => {
      await page.goto(
        workspaceHref("no-such-project", view, view === "site" ? "montrose" : undefined),
      );

      if (view === "map" || view === "site") {
        await expect(page.getByRole("heading", { name: /could not be found/i })).toBeVisible();
        return;
      }

      await expect(page.getByRole("heading", { level: 1, name: views[view] })).toBeVisible();
      await expect(page.getByRole("heading", { level: 2, name: "Project unavailable" })).toBeVisible();
      await expect(page.getByText(/\bat\s+\S+\s+\(.*:\d+:\d+\)/)).toHaveCount(0);

      await page.getByRole("link", { name: "Open example project" }).click();
      await expect(page).toHaveURL(/\/projects\/houston-coffee\/intake$/);
    });
  }

  test("an unknown siteId shows a way back to the map", async ({ page, projectId }) => {
    await page.goto(workspaceHref(projectId, "site", "no-such-site"));
    await expect(page.getByRole("heading", { name: /could not be found/i })).toBeVisible();
  });

  test("an unknown ?site= on a list view does not break the page", async ({ page, gotoView }) => {
    const problems = trackConsole(page);
    await gotoView("comparison", "no-such-site");
    await expect(page.getByRole("heading", { level: 1, name: "Comparison" })).toBeVisible();
    await expect(page.getByRole("table")).toBeVisible();
    expect(problems).toEqual([]);
  });

  test("a repeated ?site= parameter does not break the page", async ({ page, projectId }) => {
    await page.goto(`/projects/${projectId}/map?site=heights&site=montrose`);
    await expect(page.getByRole("heading", { level: 1, name: "Map" })).toBeVisible();
    await expect(page.getByRole("link", { name: /Heights storefront/ })).toBeVisible();
  });

  for (const path of ["/does-not-exist", "/projects/houston-coffee/does-not-exist", "/projects/houston-coffee/sites"]) {
    test(`${path} returns 404`, async ({ page }) => {
      const response = await page.goto(path);
      expect(response?.status()).toBe(404);
      await expect(page.getByRole("heading", { name: /could not be found/i })).toBeVisible();
    });
  }

  test("a malformed percent-escape in the URL does not produce a bare server error", async ({ page, projectId }) => {
    test.fixme(
      true,
      // Next.js fails to decode the dynamic [siteId] param before the page runs (the page's own
      // decodeURIComponent guard never executes), so `next start` answers a plain-text 500.
      // Vercel's edge rejects the URL with 400 first, so production never shows the 500.
      // A proxy.ts guard would add middleware to every request; not worth it for this.
      "Known: local `next start` answers 500 for a malformed escape in a dynamic segment; production answers 400 at the edge",
    );
    const response = await page.goto(`/projects/${projectId}/sites/%ZZ`);
    expect(response?.status()).toBeLessThan(500);
  });
});

test.describe("loading", () => {
  test("loading.tsx shows before a view's content while its data is pending", async ({ page, gotoView }) => {
    test.fixme(
      true,
      "The current fixture-backed project views are synchronous; enable this when a view awaits server data and can exercise the loading boundary.",
    );
    // Hold back the navigation (RSC) request for the next view until we release it.
    // Prefetch requests are let through so the loading boundary is already known.
    let release: () => void = () => {};
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    await page.route(/\/projects\/houston-coffee\/comparison/, async (route) => {
      const headers = route.request().headers();
      if (headers["rsc"] === "1" && !headers["next-router-prefetch"]) await gate;
      await route.continue();
    });

    await gotoView("intake");
    await expect(page.getByRole("heading", { level: 1, name: "Intake" })).toBeVisible();
    await page.waitForLoadState("networkidle");

    await navLink(page, "comparison").click();
    await expect(page.getByRole("status").filter({ hasText: "Loading project view" })).toBeVisible();
    await expect(page.getByRole("heading", { level: 1, name: "Comparison" })).toHaveCount(0);

    release();
    await expect(page.getByRole("heading", { level: 1, name: "Comparison" })).toBeVisible();
    await expect(page.getByRole("status").filter({ hasText: "Loading project view" })).toHaveCount(0);
  });
});

test.describe("responsive layout", () => {
  const widths = [375, 768, 1280];
  const cases: { view: View; siteId?: string }[] = VIEW_ORDER.map((view) => ({
    view,
    siteId: view === "site" ? DEFAULT_SITE : undefined,
  }));

  for (const width of widths) {
    for (const { view, siteId } of cases) {
      test(`${view} at ${width}px: no horizontal scroll, nav reachable, nothing overlaps`, async ({
        page,
        gotoView,
      }, testInfo) => {
        await page.setViewportSize({ width, height: 900 });
        await gotoView(view, siteId);
        await expect(page.getByRole("heading", { level: 1, name: views[view] })).toBeVisible();

        // No horizontal page scroll.
        const { scrollWidth, innerWidth } = await page.evaluate(() => ({
          scrollWidth: document.documentElement.scrollWidth,
          innerWidth: window.innerWidth,
        }));
        expect(scrollWidth, "document scrollWidth vs viewport width").toBeLessThanOrEqual(innerWidth);

        // Every nav link can be scrolled to, is inside the viewport horizontally, and is clickable.
        const links = projectNav(page).getByRole("link");
        await expect(links).toHaveCount(VIEW_ORDER.length);
        const boxes: { x: number; y: number; width: number; height: number }[] = [];
        for (const link of await links.all()) {
          await link.scrollIntoViewIfNeeded();
          await expect(link).toBeVisible();
          const box = await link.boundingBox();
          expect(box, "nav link has a box").not.toBeNull();
          expect(box!.x).toBeGreaterThanOrEqual(0);
          expect(box!.x + box!.width).toBeLessThanOrEqual(innerWidth);
          boxes.push(box!);
        }

        // Nav links do not overlap each other, and the nav sits above the page heading.
        for (let i = 0; i < boxes.length; i++) {
          for (let j = i + 1; j < boxes.length; j++) {
            const a = boxes[i]!;
            const b = boxes[j]!;
            const overlaps =
              a.x < b.x + b.width && b.x < a.x + a.width && a.y < b.y + b.height && b.y < a.y + a.height;
            expect(overlaps, `nav links ${i} and ${j} overlap`).toBe(false);
          }
        }
        const navBox = (await projectNav(page).boundingBox())!;
        const h1Box = (await page.getByRole("heading", { level: 1 }).boundingBox())!;
        expect(navBox.y + navBox.height, "nav bottom vs h1 top").toBeLessThanOrEqual(h1Box.y);

        // The main content region stays inside the viewport.
        const regionBox = (await page.getByRole("region", { name: views[view], exact: true }).boundingBox())!;
        expect(regionBox.x).toBeGreaterThanOrEqual(0);
        expect(regionBox.x + regionBox.width).toBeLessThanOrEqual(innerWidth);

        await testInfo.attach(`${view}-${width}px`, {
          body: await page.screenshot({ fullPage: true }),
          contentType: "image/png",
        });
      });
    }
  }
});

test.describe("console", () => {
  for (const view of VIEW_ORDER) {
    test(`the ${view} view logs no errors, warnings or hydration problems`, async ({ page, gotoView }) => {
      const problems = trackConsole(page);
      await gotoView(view, view === "site" ? DEFAULT_SITE : undefined);
      await expect(page.getByRole("heading", { level: 1, name: views[view] })).toBeVisible();
      // Let hydration finish before asserting (the nav link still works afterwards).
      await page.waitForLoadState("networkidle");
      expect(problems).toEqual([]);
    });
  }

  test("moving through every view client-side logs no errors", async ({ page, gotoView }) => {
    const problems = trackConsole(page);
    await gotoView("intake");
    for (const view of VIEW_ORDER) {
      await navLink(page, view).click();
      await expect(page.getByRole("heading", { level: 1, name: views[view] })).toBeVisible();
    }
    expect(problems).toEqual([]);
  });
});
