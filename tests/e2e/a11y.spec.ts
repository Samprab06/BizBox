import type { Page } from "@playwright/test";
import { views, workspaceHref, type View } from "../../lib/client/workspace-routes";
import { expect, expectNoA11yViolations, test } from "./fixtures";

const VIEW_ORDER = Object.keys(views) as View[];
const siteFor = (view: View) => (view === "site" ? "montrose" : undefined);

/**
 * Moves keyboard focus forward once. macOS WebKit follows Safari's default and skips links on
 * plain Tab (it needs Option+Tab), so use Alt+Tab there; every other browser and platform uses Tab.
 */
async function pressTab(page: Page, browserName: string) {
  await page.keyboard.press(browserName === "webkit" && process.platform === "darwin" ? "Alt+Tab" : "Tab");
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
  for (const view of VIEW_ORDER) {
    test(`${view} view`, async ({ page, gotoView }) => {
      await gotoView(view, siteFor(view));
      await expect(page.getByRole("heading", { level: 1, name: views[view] })).toBeVisible();
      await expectNoA11yViolations(page);
    });
  }

  test("project unavailable state", async ({ page }) => {
    await page.goto(workspaceHref("no-such-project", "map"));
    await expect(page.getByRole("heading", { name: /could not be found/i })).toBeVisible();
    await expectNoA11yViolations(page);
  });

  test("site selection prompt (/sites/unselected)", async ({ page, gotoView }) => {
    await gotoView("site");
    await expect(page.getByRole("status")).toHaveText("Choose a site from the map to view details.");
    await expectNoA11yViolations(page);
  });
});

test.describe("page structure", () => {
  for (const view of VIEW_ORDER) {
    test(`${view} view has one h1, one main landmark, a banner and a labelled nav`, async ({ page, gotoView }) => {
      await gotoView(view, siteFor(view));

      await expect(page.getByRole("heading", { level: 1 })).toHaveCount(1);
      await expect(page.getByRole("heading", { level: 1 })).toHaveText(views[view]);
      await expect(page.getByRole("main")).toHaveCount(1);
      await expect(page.getByRole("banner")).toHaveCount(1);
      await expect(page.getByRole("navigation", { name: "Project views" })).toHaveCount(1);
      // The nav and the h1 live inside <main>.
      await expect(page.getByRole("main").getByRole("navigation", { name: "Project views" })).toBeVisible();
      await expect(page.getByRole("main").getByRole("heading", { level: 1 })).toBeVisible();
      // The page has a document title and a language.
      await expect(page).toHaveTitle(/\S/);
      await expect(page.locator("html")).toHaveAttribute("lang", "en");
    });
  }

  test("the 404 page has one h1", async ({ page }) => {
    await page.goto("/does-not-exist");
    await expect(page.getByRole("heading", { level: 1 })).toHaveCount(1);
  });

  test("the unavailable states have one h1 and a main landmark", async ({ page }) => {
    await page.goto(workspaceHref("no-such-project", "comparison"));
    await expect(page.getByRole("heading", { level: 1 })).toHaveCount(1);
    await expect(page.getByRole("main")).toHaveCount(1);
  });
});

test.describe("keyboard and focus", () => {
  test("the first Tab stop is a skip link or the Sitework home link", async ({ page, gotoView, browserName }) => {
    test.skip(
      browserName === "webkit" && process.platform === "win32",
      "Playwright WebKit on Windows does not emulate system full-keyboard link focus.",
    );
    await gotoView("map");
    await pressTab(page, browserName);

    const first = page.locator(":focus");
    await expect(first).toBeVisible();
    const name = (await first.textContent())?.trim() ?? "";
    // A skip link ("Skip to ...") is ideal; the header's home link is also a sensible first stop.
    expect(name).toMatch(/^(skip to|sitework$)/i);
  });

  test("the project nav is reachable by Tab, in order, and Enter follows a link", async ({
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

    const seen: string[] = [];
    for (let i = 0; i < 10 && seen.length < VIEW_ORDER.length; i++) {
      await pressTab(page, browserName);
      const text = (await page.locator(":focus").textContent())?.trim() ?? "";
      if (VIEW_ORDER.some((view) => views[view] === text)) seen.push(text);
    }
    expect(seen).toEqual(VIEW_ORDER.map((view) => views[view]));

    // The last focused link is "Replay": Enter activates it.
    await page.keyboard.press("Enter");
    await expect(page).toHaveURL(workspaceHref(projectId, "replay", "montrose"));
    await expect(page.getByRole("heading", { level: 1, name: "Replay" })).toBeVisible();
  });

  for (const view of VIEW_ORDER) {
    test(`focus is visible on the header and nav links of the ${view} view`, async ({
      page,
      gotoView,
      browserName,
    }) => {
      test.skip(
        browserName === "webkit" && process.platform === "win32",
        "Playwright WebKit on Windows does not emulate system full-keyboard link focus.",
      );
      await gotoView(view, siteFor(view));

      // Header link plus the five nav links.
      for (let i = 0; i < 1 + VIEW_ORDER.length; i++) {
        await pressTab(page, browserName);
        const focus = await focusedOutline(page);
        expect(focus, "something is focused").not.toBeNull();
        const hasIndicator =
          (focus!.outlineStyle !== "none" && focus!.outlineWidth > 0) || focus!.boxShadow !== "none";
        expect(hasIndicator, `focus indicator on "${focus!.text}": ${JSON.stringify(focus)}`).toBe(true);
      }
    });
  }
});
