import type { Locator, Page } from "@playwright/test";
import { SITE_IDS, expect, expectNoA11yViolations, test } from "./fixtures";

// Example-mode interactions and the canonical intake-backed search path.

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
        layers: [
          {
            id: "background",
            type: "background",
            paint: { "background-color": "#e8efe9" },
          },
        ],
      }),
    }),
  );
}

/** The sorted site ids each link selects, e.g. /projects/x/map?site=montrose -> montrose. */
async function linkIds(links: Locator) {
  const hrefs = await links.evaluateAll((nodes) =>
    nodes.map((node) => node.getAttribute("href") ?? ""),
  );
  return hrefs
    .map((href) => new URL(href, "http://localhost").searchParams.get("site"))
    .sort();
}

test.describe("map", () => {
  test.beforeEach(async ({ page }) => {
    await stubMapStyle(page);
  });

  test("every candidate site is a map marker and a list row, with the same ids", async ({
    page,
    gotoView,
  }) => {
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

  // HAC-45: choosing a candidate selects it on the map (?site=<id>, highlighted marker and
  // row); its detail opens from the "View details for ..." link.
  test("a marker selects its site, and View details opens it", async ({
    page,
    gotoView,
  }) => {
    await gotoView("map");
    await page.getByRole("link", { name: "Open Heights storefront" }).click();

    await expect(page).toHaveURL(
      /\/projects\/houston-coffee\/map\?site=heights$/,
    );
    await expect(
      page.getByRole("link", { name: "Open Heights storefront" }),
    ).toHaveAttribute("aria-current", "true");
    await page
      .getByRole("link", { name: "View details for Heights storefront" })
      .click();
    await expect(page).toHaveURL(/\/projects\/houston-coffee\/sites\/heights$/);
    await expect(
      page.getByRole("heading", { level: 2, name: "Heights storefront" }),
    ).toBeVisible();
  });

  test("a list row selects its site, and View details opens it", async ({
    page,
    gotoView,
  }) => {
    await gotoView("map");
    // Works around HAC-109 (map loading layout shift); remove once HAC-109 merges.
    await expect(
      page.getByRole("combobox", { name: "Catchment layer", exact: true }),
    ).toBeVisible();
    const list = page.getByRole("list", { name: "Candidate sites" });
    await list.getByRole("link", { name: /Montrose storefront/ }).click();

    await expect(page).toHaveURL(
      /\/projects\/houston-coffee\/map\?site=montrose$/,
    );
    await expect(
      list.getByRole("link", { name: /Montrose storefront/ }),
    ).toHaveAttribute("aria-current", "true");
    await page
      .getByRole("link", { name: "View details for Montrose storefront" })
      .click();
    await expect(page).toHaveURL(
      /\/projects\/houston-coffee\/sites\/montrose$/,
    );
    await expect(
      page.getByRole("heading", { level: 2, name: "Montrose storefront" }),
    ).toBeVisible();
  });

  test("the list works from the keyboard", async ({ page, gotoView }) => {
    await gotoView("map");
    const rows = page
      .getByRole("list", { name: "Candidate sites" })
      .getByRole("link");

    await rows.first().focus();
    await expect(rows.first()).toBeFocused();
    // Safari's default is not to Tab onto links (that needs Option+Tab), so WebKit
    // reaches the second row by focus() instead. Every row is a native, focusable link.
    if (test.info().project.name === "webkit") await rows.nth(1).focus();
    else await page.keyboard.press("Tab");
    await expect(rows.nth(1)).toBeFocused();

    await page.keyboard.press("Enter");
    await expect(page).toHaveURL(
      /\/projects\/houston-coffee\/map\?site=heights$/,
    );
  });

  for (const [siteId, residents, workers] of [
    ["montrose", "12,400", "8,600"],
    ["heights", "10,900", "6,700"],
  ] as const) {
    test(`?site=${siteId} selects that site: catchment summary and view links follow it`, async ({
      page,
      gotoView,
    }) => {
      await gotoView("map", siteId);

      await expect(
        page.getByText(`The ring contains an estimated ${residents} residents`),
      ).toBeVisible();
      await page.getByLabel("Catchment layer").selectOption("workers");
      await expect(
        page.getByText(`The ring contains an estimated ${workers} workers`),
      ).toBeVisible();

      const nav = page.getByRole("navigation", { name: "Project views" });
      await expect(
        nav.getByRole("link", { name: "Site detail" }),
      ).toHaveAttribute("href", new RegExp(`/sites/${siteId}$`));
      await expect(nav.getByRole("link", { name: "Map" })).toHaveAttribute(
        "href",
        new RegExp(`\\?site=${siteId}$`),
      );
    });
  }

  test("Back to map from a site returns to the map with that site selected", async ({
    page,
    gotoView,
  }) => {
    await gotoView("site", "heights");
    await page.getByRole("link", { name: "Back to map" }).click();

    await expect(page).toHaveURL(
      /\/projects\/houston-coffee\/map\?site=heights$/,
    );
    await expect(
      page.getByText("The ring contains an estimated 10,900 residents"),
    ).toBeVisible();
  });

  test("an unknown ?site= on the map does not break it", async ({
    page,
    gotoView,
  }) => {
    await gotoView("map", "no-such-site");

    await expect(page.getByRole("link", { name: /^Open .+/ })).toHaveCount(
      SITE_IDS.length,
    );
    await expect(page.getByText(/The ring contains/)).toHaveCount(0);
  });

  test("when the map style fails to load, the map says so and the list still works", async ({
    page,
    gotoView,
  }) => {
    await page.unroute(MAP_STYLE_URL);
    await page.route(MAP_STYLE_URL, (route) => route.abort());
    await gotoView("map");

    await expect(
      page.getByRole("alert").filter({ hasText: "The map is unavailable" }),
    ).toHaveText("The map is unavailable. Choose a candidate below.");
    await expect(page.getByRole("button", { name: "Retry map" })).toBeVisible();
    await page
      .getByRole("list", { name: "Candidate sites" })
      .getByRole("link", { name: /Montrose storefront/ })
      .click();
    await expect(page).toHaveURL(/\/map\?site=montrose$/);
  });

  // HAC-45: an unknown project is a real 404, not a 200 with an "unavailable" panel.
  test("an unknown project returns 404", async ({ page }) => {
    const response = await page.goto("/projects/no-such-project/map");

    expect(response?.status()).toBe(404);
    await expect(
      page.getByRole("heading", { name: /could not be found/i }),
    ).toBeVisible();
  });

  test("has no serious or critical accessibility violations", async ({
    page,
    gotoView,
  }) => {
    await gotoView("map", "montrose");
    await expect(page.getByRole("link", { name: /^Open .+/ })).toHaveCount(
      SITE_IDS.length,
    );
    await expectNoA11yViolations(page);
  });

  // ---- Behaviour the ticket describes that HAC-21 did not ship -----------------------

  test("selecting a marker or a list row selects the site, sets ?site= and highlights it in both", async ({
    page,
    gotoView,
  }) => {
    await gotoView("map");
    const list = page.getByRole("list", { name: "Candidate sites" });

    await page.getByRole("link", { name: "Open Heights storefront" }).click();
    await expect(page).toHaveURL(/\/map\?site=heights$/);
    await expect(
      page.getByRole("link", { name: "Open Heights storefront" }),
    ).toHaveAttribute("aria-current", "true");
    await expect(
      list.getByRole("link", { name: /Heights storefront/ }),
    ).toHaveAttribute("aria-current", "true");

    await list.getByRole("link", { name: /Montrose storefront/ }).click();
    await expect(page).toHaveURL(/\/map\?site=montrose$/);
    await expect(
      page.getByRole("link", { name: "Open Montrose storefront" }),
    ).toHaveAttribute("aria-current", "true");
    await expect(
      list.getByRole("link", { name: /Montrose storefront/ }),
    ).toHaveAttribute("aria-current", "true");
  });
});

test.describe("intake-backed map", () => {
  test.beforeEach(async ({ page }) => {
    await stubMapStyle(page);
  });

  test("completed intake loads canonical sites, keeps selection and opens encoded detail", async ({
    page,
  }) => {
    const { mockLiveSites } = await import("./live-site-fixtures");
    await mockLiveSites(page);
    const request = page.waitForRequest(
      (r) => r.url().endsWith("/api/sites") && r.method() === "POST",
    );
    await page.goto("/projects/houston-coffee/map");
    const body = (await request).postDataJSON();
    expect(body.profile.economics.monthlyRentCeilingCents.value).toBe(500000);
    expect(body.limit).toBe(8);
    const row = page
      .getByRole("list", { name: "Candidate sites" })
      .getByRole("link");
    await expect(row).toHaveCount(1);
    await expect(row).toContainText("101 Invented St");
    await expect(
      page
        .getByRole("region", { name: "Candidate locations", exact: true })
        .getByText("Example data", { exact: true }),
    ).toHaveCount(0);
    await expect(
      page.getByRole("region", { name: "Search diagnostics" }),
    ).toContainText("city");
    await expect(page.getByText(/rent_unknown/).first()).toBeVisible();
    await row.focus();
    await page.keyboard.press("Enter");
    await expect(page).toHaveURL(/map\?site=201%3A301$/);
    await expect(row).toHaveAttribute("aria-current", "true");
    await expect(
      page.getByRole("link", { name: "Open 101 Invented St" }),
    ).toHaveAttribute("aria-current", "true");
    await page
      .getByRole("link", { name: "View details for 101 Invented St" })
      .click();
    await expect(page).toHaveURL(/sites\/201%3A301$/);
    await expect(
      page.getByRole("heading", { name: "101 Invented St" }),
    ).toBeVisible();
  });

  test("successful empty search stays empty and explains the restrictive filter", async ({
    page,
  }) => {
    const { mockLiveSites, liveSearch } = await import("./live-site-fixtures");
    await mockLiveSites(page);
    await page.route("**/api/sites", (route) =>
      route.fulfill({
        json: {
          ...liveSearch,
          candidates: [],
          totalMatched: 0,
          emptyReason: "No inventory matches the rent ceiling",
          mostRestrictiveFilter: "rentCeiling",
        },
      }),
    );
    await page.goto("/projects/houston-coffee/map");
    await expect(
      page.getByText("No inventory matches the rent ceiling"),
    ).toBeVisible();
    await expect(
      page.getByText(/Most restrictive filter: rentCeiling/),
    ).toBeVisible();
    await expect(
      page.getByRole("list", { name: "Candidate sites" }),
    ).toHaveCount(0);
    await expect(
      page
        .getByRole("region", { name: "Candidate locations", exact: true })
        .getByText("Example data", { exact: true }),
    ).toHaveCount(0);
  });

  test("failed search is labelled example data and retry recovers live results", async ({
    page,
  }) => {
    const { mockLiveSites, liveSearch } = await import("./live-site-fixtures");
    await mockLiveSites(page);
    let failed = true;
    await page.route("**/api/sites", (route) =>
      failed
        ? route.fulfill({ status: 503, json: { error: "Unavailable" } })
        : route.fulfill({ json: liveSearch }),
    );
    await page.goto("/projects/houston-coffee/map");
    await expect(
      page
        .getByRole("alert")
        .filter({ hasText: /Candidate search unavailable/ }),
    ).toBeVisible();
    await expect(
      page
        .getByRole("region", { name: "Candidate locations", exact: true })
        .getByText("Example data", { exact: true }),
    ).toBeVisible();
    failed = false;
    await page.getByRole("button", { name: "Retry search" }).click();
    await expect(
      page
        .getByRole("list", { name: "Candidate sites", exact: true })
        .getByRole("link", { name: /101 Invented St/ }),
    ).toBeVisible();
    await expect(
      page
        .getByRole("region", { name: "Candidate locations", exact: true })
        .getByText("Example data", { exact: true }),
    ).toHaveCount(0);
  });
});

test.describe("live map boundaries", () => {
  test.beforeEach(async ({ page }) => {
    await stubMapStyle(page);
  });

  test("missing, corrupt and denied storage show honest examples without a search", async ({
    page,
  }) => {
    let requests = 0;
    const errors: string[] = [];
    page.on("pageerror", (error) => errors.push(error.message));
    await page.route("**/api/sites", async (route) => {
      requests++;
      await route.fulfill({ status: 503, json: {} });
    });
    await page.goto("/projects/houston-coffee/map");
    await expect(
      page
        .getByRole("region", { name: "Candidate locations", exact: true })
        .getByText("Example data", { exact: true }),
    ).toBeVisible();
    await expect(
      page.getByText(/Complete your intake to search live listings/),
    ).toBeVisible();
    await page.evaluate(() =>
      localStorage.setItem("sitework:intake:v1:houston-coffee", "{broken"),
    );
    await page.getByRole("button", { name: "Retry search" }).click();
    await expect(
      page.getByText(/Saved intake could not be read/),
    ).toBeVisible();
    await page.evaluate(() => {
      Object.defineProperty(window, "localStorage", {
        get() {
          throw new DOMException("Denied", "SecurityError");
        },
        configurable: true,
      });
    });
    await page.getByRole("button", { name: "Retry search" }).click();
    await expect(
      page.getByText(/Saved intake could not be read/),
    ).toBeVisible();
    expect(requests).toBe(0);
    expect(errors).toEqual([]);
  });

  test("live LA coordinates center the map and unknown coordinates stay list-only", async ({
    page,
  }) => {
    const { mockLiveSites, liveSearch } = await import("./live-site-fixtures");
    await mockLiveSites(page);
    const result = structuredClone(liveSearch);
    result.candidates[0].candidate.latitude.value = 34.05;
    result.candidates[0].candidate.longitude.value = -118.24;
    result.candidates[0].candidate.city = "Los Angeles";
    await page.route("**/api/sites", (route) =>
      route.fulfill({ json: result }),
    );
    await page.goto("/projects/houston-coffee/map?site=unknown");
    await page
      .getByRole("region", { name: "Map", exact: true })
      .scrollIntoViewIfNeeded();
    await expect(
      page.getByRole("link", { name: "Open 101 Invented St" }),
    ).toBeInViewport();
    await expect(
      page.getByRole("list", { name: "Candidate sites" }).getByRole("link"),
    ).toHaveCount(1);
    result.candidates[0].candidate.latitude = {
      ...result.candidates[0].candidate.latitude,
      value: null,
      unknownReason: "Coordinates missing",
    };
    await page.getByRole("button", { name: "Retry search" }).click();
    await expect(
      page.getByText("Coordinates unknown · available in list only"),
    ).toBeVisible();
    await expect(page.getByRole("link", { name: /^Open .+/ })).toHaveCount(0);
  });

  test("malformed response falls back and a hung request times out with retry", async ({
    page,
  }) => {
    const { mockLiveSites } = await import("./live-site-fixtures");
    await mockLiveSites(page);
    await page.route("**/api/sites", (route) =>
      route.fulfill({ json: { candidates: [] } }),
    );
    await page.goto("/projects/houston-coffee/map");
    await expect(
      page
        .getByRole("alert")
        .filter({ hasText: /Candidate search unavailable/ }),
    ).toBeVisible();
    await page.clock.install();
    await page.route("**/api/sites", () => new Promise(() => {}));
    const request = page.waitForRequest((r) => r.url().endsWith("/api/sites"));
    await page.getByRole("button", { name: "Retry search" }).click();
    await request;
    await page.clock.fastForward(15_001);
    await expect(
      page
        .getByRole("alert")
        .filter({ hasText: /Candidate search unavailable/ }),
    ).toBeVisible();
    await expect(
      page
        .getByRole("region", { name: "Candidate locations", exact: true })
        .getByText("Example data", { exact: true }),
    ).toBeVisible();
  });

  test("live map works across widths with reduced motion and no blocking accessibility issues", async ({
    page,
  }) => {
    const { mockLiveSites } = await import("./live-site-fixtures");
    await mockLiveSites(page);
    await page.emulateMedia({ reducedMotion: "reduce" });
    await page.goto("/projects/houston-coffee/map?site=201%3A301");
    await expect(
      page.getByRole("link", { name: "View details for 101 Invented St" }),
    ).toBeVisible();
    for (const width of [390, 820, 1280]) {
      await page.setViewportSize({ width, height: 900 });
      expect(
        await page.evaluate(
          () => document.documentElement.scrollWidth <= window.innerWidth,
        ),
      ).toBe(true);
    }
    await expectNoA11yViolations(page);
  });
});
