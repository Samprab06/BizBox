import type { Locator, Page } from "@playwright/test";
import { SITE_IDS, expect, expectNoA11yViolations, test } from "./fixtures";

// HAC-32: map screen. These specs target the map shipped by HAC-21 (PR #11), so they
// need that code: on a branch without it /map is a plain list and the marker tests fail.

const MAP_STYLE_URL = "https://tiles.openfreemap.org/**";

/**
 * Replaces the remote map style with an empty one so the map loads offline, fast and
 * identically in every browser. Markers are DOM elements, so they still render.
 */
async function stubMapStyle(page: Page) {
  await page.route(MAP_STYLE_URL, (route) =>
    route.fulfill({
      status: 200,
      contentType: "application/json",
      headers: { "access-control-allow-origin": "*" },
      body: JSON.stringify({
        version: 8,
        name: "e2e-stub",
        sources: {},
        layers: [{ id: "background", type: "background", paint: { "background-color": "#e8efe9" } }],
      }),
    }),
  );
}

/** The sorted site ids at the end of each link's href, e.g. /projects/x/sites/montrose -> montrose. */
async function linkIds(links: Locator) {
  const hrefs = await links.evaluateAll((nodes) => nodes.map((node) => node.getAttribute("href") ?? ""));
  return hrefs.map((href) => new URL(href, "http://localhost").pathname.split("/").pop()).sort();
}

test.describe("map", () => {
  test.beforeEach(async ({ page }) => {
    await stubMapStyle(page);
  });

  test("every candidate site is a map marker and a list row, with the same ids", async ({ page, gotoView }) => {
    await gotoView("map");

    const list = page.getByRole("list", { name: "Candidate sites" });
    const markers = page.getByRole("link", { name: /^Open .+/ });
    await expect(markers).toHaveCount(SITE_IDS.length);
    await expect(list.getByRole("link")).toHaveCount(SITE_IDS.length);

    const markerIds = await linkIds(markers);
    const listIds = await linkIds(list.getByRole("link"));
    expect(markerIds).toEqual([...SITE_IDS].sort());
    expect(listIds).toEqual(markerIds);
  });

  test("a marker opens its site detail", async ({ page, gotoView }) => {
    await gotoView("map");
    await page.getByRole("link", { name: "Open Heights storefront" }).click();

    await expect(page).toHaveURL(/\/projects\/houston-coffee\/sites\/heights$/);
    await expect(page.getByRole("heading", { level: 2, name: "Heights storefront" })).toBeVisible();
  });

  test("a list row opens its site detail", async ({ page, gotoView }) => {
    await gotoView("map");
    await page.getByRole("list", { name: "Candidate sites" }).getByRole("link", { name: /Montrose storefront/ }).click();

    await expect(page).toHaveURL(/\/projects\/houston-coffee\/sites\/montrose$/);
    await expect(page.getByRole("heading", { level: 2, name: "Montrose storefront" })).toBeVisible();
  });

  test("the list works from the keyboard", async ({ page, gotoView }) => {
    await gotoView("map");
    const rows = page.getByRole("list", { name: "Candidate sites" }).getByRole("link");

    await rows.first().focus();
    await expect(rows.first()).toBeFocused();
    // Safari's default is not to Tab onto links (that needs Option+Tab), so WebKit
    // reaches the second row by focus() instead. Every row is a native, focusable link.
    if (test.info().project.name === "webkit") await rows.nth(1).focus();
    else await page.keyboard.press("Tab");
    await expect(rows.nth(1)).toBeFocused();

    await page.keyboard.press("Enter");
    await expect(page).toHaveURL(/\/projects\/houston-coffee\/sites\/heights$/);
  });

  for (const [siteId, residents, workers] of [
    ["montrose", "12,400", "8,600"],
    ["heights", "10,900", "6,700"],
  ] as const) {
    test(`?site=${siteId} selects that site: catchment summary and view links follow it`, async ({ page, gotoView }) => {
      await gotoView("map", siteId);

      await expect(page.getByText(`The ring contains an estimated ${residents} residents`)).toBeVisible();
      await page.getByLabel("Catchment layer").selectOption("workers");
      await expect(page.getByText(`The ring contains an estimated ${workers} workers`)).toBeVisible();

      const nav = page.getByRole("navigation", { name: "Project views" });
      await expect(nav.getByRole("link", { name: "Site detail" })).toHaveAttribute("href", new RegExp(`/sites/${siteId}$`));
      await expect(nav.getByRole("link", { name: "Map" })).toHaveAttribute("href", new RegExp(`\\?site=${siteId}$`));
    });
  }

  test("Back to map from a site returns to the map with that site selected", async ({ page, gotoView }) => {
    await gotoView("site", "heights");
    await page.getByRole("link", { name: "Back to map" }).click();

    await expect(page).toHaveURL(/\/projects\/houston-coffee\/map\?site=heights$/);
    await expect(page.getByText("The ring contains an estimated 10,900 residents")).toBeVisible();
  });

  test("an unknown ?site= on the map does not break it", async ({ page, gotoView }) => {
    await gotoView("map", "no-such-site");

    await expect(page.getByRole("link", { name: /^Open .+/ })).toHaveCount(SITE_IDS.length);
    await expect(page.getByText(/The ring contains/)).toHaveCount(0);
  });

  test("when the map style fails to load, the map says so and the list still works", async ({ page, gotoView }) => {
    await page.unroute(MAP_STYLE_URL);
    await page.route(MAP_STYLE_URL, (route) => route.abort());
    await gotoView("map");

    await expect(page.getByRole("status")).toHaveText("The map is unavailable. Choose a candidate below.");
    await page.getByRole("list", { name: "Candidate sites" }).getByRole("link", { name: /Montrose storefront/ }).click();
    await expect(page).toHaveURL(/\/sites\/montrose$/);
  });

  test("an unknown project shows the unavailable state with a way back", async ({ page }) => {
    await page.goto("/projects/no-such-project/map");

    await expect(page.getByRole("heading", { level: 2, name: "Project unavailable" })).toBeVisible();
    await page.getByRole("link", { name: "Open example project" }).click();
    await expect(page).toHaveURL(/\/projects\/houston-coffee\/intake$/);
  });

  test("has no serious or critical accessibility violations", async ({ page, gotoView }) => {
    test.fixme(
      true,
      "axe: each site marker is a react-map-gl role=button aria-label='Map marker' wrapping a focusable link " +
        "(nested-interactive, label-content-name-mismatch), components/map/candidate-map.tsx",
    );
    await gotoView("map", "montrose");
    await expect(page.getByRole("link", { name: /^Open .+/ })).toHaveCount(SITE_IDS.length);
    await expectNoA11yViolations(page);
  });

  // ---- Behaviour the ticket describes that HAC-21 did not ship -----------------------

  test("selecting a marker or a list row selects the site, sets ?site= and highlights it in both", async ({ page, gotoView }) => {
    test.fixme(true, "HAC-21 navigates straight to /sites/<id> on click: no select state, no highlight, ?site= is not set by clicking");
    await gotoView("map");
    const list = page.getByRole("list", { name: "Candidate sites" });

    await page.getByRole("link", { name: "Open Heights storefront" }).click();
    await expect(page).toHaveURL(/\/map\?site=heights$/);
    await expect(page.getByRole("link", { name: "Open Heights storefront" })).toHaveAttribute("aria-current", "true");
    await expect(list.getByRole("link", { name: /Heights storefront/ })).toHaveAttribute("aria-current", "true");

    await list.getByRole("link", { name: /Montrose storefront/ }).click();
    await expect(page).toHaveURL(/\/map\?site=montrose$/);
    await expect(page.getByRole("link", { name: "Open Montrose storefront" })).toHaveAttribute("aria-current", "true");
    await expect(list.getByRole("link", { name: /Montrose storefront/ })).toHaveAttribute("aria-current", "true");
  });

  test("a zero-site project shows an empty state", async ({ page }) => {
    test.fixme(true, "HAC-21 reads sites from a hard-coded fixture: nothing to mock, no empty state exists");
    await page.route("**/api/**/sites*", (route) => route.fulfill({ json: { sites: [] } }));
    await page.goto("/projects/houston-coffee/map");
    await expect(page.getByText(/no (candidate )?(sites|spaces)/i)).toBeVisible();
  });

  test("a failing sites request shows an error with retry", async ({ page }) => {
    test.fixme(true, "HAC-21 makes no data request on the map: nothing to fail, no error or retry UI exists");
    await page.route("**/api/**/sites*", (route) => route.fulfill({ status: 500, body: "boom" }));
    await page.goto("/projects/houston-coffee/map");
    await expect(page.getByRole("alert")).toBeVisible();
    await expect(page.getByRole("button", { name: /retry/i })).toBeVisible();
  });
});
