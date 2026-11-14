import type { Page } from "@playwright/test";
import {
  nextStep,
  routeLabels,
  workspaceHref,
  workspaceSteps,
  type WorkspaceRoute,
} from "../../lib/client/workspace-routes";
import {
  expect,
  expectNoA11yViolations,
  test,
  viewHeading,
  expandProjectNavigation,
} from "./fixtures";

// Every route the navigation links to, in task order.
const NAV_ORDER: WorkspaceRoute[] = workspaceSteps.map((step) => step.route);
const siteFor = (view: WorkspaceRoute) =>
  view === "site" ? "montrose" : undefined;

/**
 * Moves keyboard focus forward once. macOS WebKit follows Safari's default and skips links on
 * plain Tab (it needs Option+Tab), so use Alt+Tab there; every other browser and platform uses Tab.
 */
async function pressTab(page: Page, browserName: string) {
  await page.keyboard.press(
    browserName === "webkit" && process.platform === "darwin"
      ? "Alt+Tab"
      : "Tab",
  );
  await expect(page.locator(":focus")).toHaveCount(1);
}

async function focusedOutline(page: Page) {
  return page.evaluate(() => {
    const el = document.activeElement;
    if (!el || el === document.body) return null;
    const style = getComputedStyle(el);
    return {
      tag: el.tagName,
      text: (el.textContent ?? "").trim().slice(0, 40),
      outlineStyle: style.outlineStyle,
      outlineWidth: parseFloat(style.outlineWidth),
      boxShadow: style.boxShadow,
    };
  });
}

test.describe("every view passes the axe scan", () => {
  for (const view of NAV_ORDER) {
    test(`${view} view`, async ({ page, gotoView }) => {
      await gotoView(view, siteFor(view));
      await expandProjectNavigation(page);
      await expect(
        page.getByRole("heading", { level: 1, name: viewHeading(view) }),
      ).toBeVisible();
      await expectNoA11yViolations(page);
    });
  }

  // The navigation reflows from three columns to a stack; scan both extremes.
  for (const width of [375, 1280]) {
    for (const view of NAV_ORDER) {
      test(`${view} view at ${width}px`, async ({ page, gotoView }) => {
        await page.setViewportSize({ width, height: 900 });
        await gotoView(view, siteFor(view));
        await expandProjectNavigation(page);
        await expect(
          page.getByRole("heading", { level: 1, name: viewHeading(view) }),
        ).toBeVisible();
        await expectNoA11yViolations(page);
      });
    }
  }

  test("project unavailable state", async ({ page }) => {
    await page.goto(workspaceHref("no-such-project", "map"));
    await expect(
      page.getByRole("heading", { name: /could not be found/i }),
    ).toBeVisible();
    await expectNoA11yViolations(page);
  });

  test("site selection prompt (/sites/unselected)", async ({
    page,
    gotoView,
  }) => {
    await gotoView("site");
    await expandProjectNavigation(page);
    await expect(page.getByRole("status")).toHaveText(
      "Choose a site from the map to view details.",
    );
    await expectNoA11yViolations(page);
  });
});

test.describe("page structure", () => {
  for (const view of NAV_ORDER) {
    test(`${view} view has one h1, one main landmark, a banner and a labelled nav`, async ({
      page,
      gotoView,
    }) => {
      await gotoView(view, siteFor(view));
      await expandProjectNavigation(page);

      await expect(page.getByRole("heading", { level: 1 })).toHaveCount(1);
      await expect(page.getByRole("heading", { level: 1 })).toHaveText(
        viewHeading(view),
      );
      await expect(page.getByRole("main")).toHaveCount(1);
      await expect(page.getByRole("banner")).toHaveCount(1);
      await expect(
        page.getByRole("navigation", { name: "Project views" }),
      ).toHaveCount(1);
      // The nav and the h1 live inside <main>.
      await expect(
        page
          .getByRole("main")
          .getByRole("navigation", { name: "Project views" }),
      ).toBeVisible();
      await expect(
        page.getByRole("main").getByRole("heading", { level: 1 }),
      ).toBeVisible();
      // The page has a document title and a language.
      await expect(page).toHaveTitle(/\S/);
      await expect(page.locator("html")).toHaveAttribute("lang", "en");
    });
  }

  test("the 404 page has one h1", async ({ page }) => {
    await page.goto("/does-not-exist");
    await expect(page.getByRole("heading", { level: 1 })).toHaveCount(1);
  });

  test("the unavailable states have one h1 and a main landmark", async ({
    page,
  }) => {
    await page.goto(workspaceHref("no-such-project", "comparison"));
    await expect(page.getByRole("heading", { level: 1 })).toHaveCount(1);
    await expect(page.getByRole("main")).toHaveCount(1);
  });
});

test.describe("keyboard and focus", () => {
  test("the first Tab stop is a skip link or the Sitework home link", async ({
    page,
    gotoView,
    browserName,
  }) => {
    test.skip(
      browserName === "webkit" && process.platform === "win32",
      "Playwright WebKit on Windows does not emulate system full-keyboard link focus.",
    );
    await gotoView("map");
    await expandProjectNavigation(page);
    await pressTab(page, browserName);

    const first = page.locator(":focus");
    await expect(first).toBeVisible();
    const name = (await first.textContent())?.trim() ?? "";
    // A skip link ("Skip to ...") is ideal; the header's home link is also a sensible first stop.
    expect(name).toMatch(/^(skip to|sitework$)/i);
  });

  for (const width of [375, 1280]) {
    test(`the task links are reachable by Tab, in task order, and Enter follows a link at ${width}px`, async ({
      page,
      gotoView,
      projectId,
      browserName,
    }) => {
      test.skip(
        browserName === "webkit" && process.platform === "win32",
        "Playwright WebKit on Windows does not emulate system full-keyboard link focus.",
      );
      await page.setViewportSize({ width, height: 900 });
      await gotoView("map");
      await expandProjectNavigation(page);

      const labels = NAV_ORDER.map((route) => routeLabels[route]);
      const seen: string[] = [];
      // The context bar sits before the nav and adds its own tab stops, so allow for them.
      for (let i = 0; i < 25 && seen.length < NAV_ORDER.length; i++) {
        await pressTab(page, browserName);
        const text = (await page.locator(":focus").textContent())?.trim() ?? "";
        if (labels.includes(text)) seen.push(text);
      }
      expect(seen).toEqual(labels);

      // The last focused link is the plan: Enter activates it.
      await page.keyboard.press("Enter");
      await expect(page).toHaveURL(workspaceHref(projectId, "plan"));
      await expect(
        page.getByRole("heading", { level: 1, name: "Location plan" }),
      ).toBeVisible();
    });
  }

  test("the Next step is the last stop in the nav and Enter follows it", async ({
    page,
    gotoView,
    projectId,
    browserName,
  }) => {
    test.skip(
      browserName === "webkit" && process.platform === "win32",
      "Playwright WebKit on Windows does not emulate system full-keyboard link focus.",
    );
    await gotoView("map");
    await expandProjectNavigation(page);
    // Tab past the header, the context bar and the task links to the Next step.
    const focused = page.locator(":focus");
    for (
      let i = 0;
      i <
      (await page
        .locator('a[href],button,input,select,summary,[tabindex="0"]')
        .count()) +
        1;
      i++
    ) {
      await pressTab(page, browserName);
      if ((await focused.getAttribute("data-next-step")) !== null) break;
    }
    await expect(focused).toHaveText(`Next: ${nextStep("map")!.step}`);
    await page.keyboard.press("Enter");
    await expect(page).toHaveURL(workspaceHref(projectId, "site", "montrose"));
    await expect(
      page.getByRole("heading", { level: 1, name: "Site detail" }),
    ).toBeVisible();
  });

  for (const view of NAV_ORDER) {
    test(`focus is visible on the header, context bar and nav links of the ${view} view`, async ({
      page,
      gotoView,
      browserName,
    }) => {
      test.skip(
        browserName === "webkit" && process.platform === "win32",
        "Playwright WebKit on Windows does not emulate system full-keyboard link focus.",
      );
      await gotoView(view, siteFor(view));
      await expandProjectNavigation(page);

      // Walk every stop up to the last one in the nav: the Next step, or the plan link when
      // there is no next step. The context bar adds its own stops before the nav.
      const lastText = nextStep(view) ? "Next:" : routeLabels.plan;
      let reachedLast = false;
      for (let i = 0; i < 25 && !reachedLast; i++) {
        await pressTab(page, browserName);
        const focus = await focusedOutline(page);
        expect(focus, "something is focused").not.toBeNull();
        const hasIndicator =
          (focus!.outlineStyle !== "none" && focus!.outlineWidth > 0) ||
          focus!.boxShadow !== "none";
        expect(
          hasIndicator,
          `focus indicator on "${focus!.text}": ${JSON.stringify(focus)}`,
        ).toBe(true);
        reachedLast = focus!.text.startsWith(lastText);
      }
      expect(reachedLast, "tabbing reaches the end of the nav").toBe(true);
    });
  }
});
