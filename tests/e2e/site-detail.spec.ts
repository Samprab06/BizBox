import type { Page } from "@playwright/test";
import { SITE_IDS, expect, expectNoA11yViolations, test } from "./fixtures";

// Example detail provenance and canonical listing/catchment flows.

// What each fixture site must show (components/site/site-fixtures.ts + lib/workspace-preview.ts).
const SITES = {
  montrose: {
    address: "Montrose storefront",
    neighborhood: "Montrose",
    size: "1,450 sq ft",
    rent: "$32/SF/year",
    residents: "12,400",
    workers: "8,600",
  },
  heights: {
    address: "Heights storefront",
    neighborhood: "The Heights",
    size: "1,820 sq ft",
    rent: "$38/SF/year",
    residents: "10,900",
    workers: "6,700",
  },
} as const;

/** Loads the map offline: the remote style is replaced by an empty one. */
async function stubMapStyle(page: Page) {
  await page.route("https://tiles.openfreemap.org/**", (route) =>
    route.fulfill({
      contentType: "application/json",
      headers: { "access-control-allow-origin": "*" },
      body: JSON.stringify({ version: 8, sources: {}, layers: [] }),
    }),
  );
}

test.describe("site detail", () => {
  for (const siteId of SITE_IDS) {
    const expected = SITES[siteId];

    test(`${siteId}: shows its address, rent, size and catchment summary`, async ({
      page,
      gotoView,
    }) => {
      await gotoView("site", siteId);

      await expect(
        page.getByRole("heading", { level: 1, name: "Site detail" }),
      ).toBeVisible();
      await expect(
        page.getByRole("heading", { level: 2, name: expected.address }),
      ).toBeVisible();
      const region = page.getByRole("region", { name: "Site detail" });
      await expect(region).toContainText(expected.neighborhood);
      await expect(region.getByText("Size", { exact: true })).toBeVisible();
      await expect(
        region.getByRole("link", { name: expected.size }),
      ).toBeVisible();
      await expect(
        region.getByText("Asking rent", { exact: true }),
      ).toBeVisible();
      await expect(
        region.getByRole("link", { name: expected.rent }),
      ).toBeVisible();
      await expect(
        region.getByText("Catchment radius", { exact: true }),
      ).toBeVisible();
      await expect(region.getByRole("link", { name: "1 mile" })).toBeVisible();
      await expect(
        region.getByRole("link", { name: expected.residents }),
      ).toBeVisible();
      await expect(
        region.getByRole("link", { name: expected.workers }),
      ).toBeVisible();
    });
  }

  test("opening a site from the map lands on /sites/<id> with that site's details", async ({
    page,
    gotoView,
  }) => {
    await stubMapStyle(page);
    await gotoView("map");
    await page.getByRole("link", { name: "Open Montrose storefront" }).click();
    await expect(page).toHaveURL(
      /\/projects\/houston-coffee\/map\?site=montrose$/,
    );
    await page
      .getByRole("link", { name: "View details for Montrose storefront" })
      .click();

    await expect(page).toHaveURL(
      /\/projects\/houston-coffee\/sites\/montrose$/,
    );
    await expect(
      page.getByRole("heading", { level: 2, name: SITES.montrose.address }),
    ).toBeVisible();
    await expect(
      page.getByRole("link", { name: SITES.montrose.rent }),
    ).toBeVisible();
    await expect(
      page.getByRole("link", { name: SITES.montrose.residents }),
    ).toBeVisible();
  });

  test("every number on every fixture site links to a source on the page", async ({
    page,
    gotoView,
  }) => {
    // The site ids come from the map list, so a site added to the fixture is covered here too.
    await stubMapStyle(page);
    await gotoView("map");
    await expect(
      page.getByRole("list", { name: "Candidate sites" }).getByRole("link"),
    ).toHaveCount(SITE_IDS.length);
    const hrefs = await page
      .getByRole("list", { name: "Candidate sites" })
      .getByRole("link")
      .evaluateAll((nodes) =>
        nodes.map((node) => node.getAttribute("href") ?? ""),
      );
    const siteIds = hrefs.map(
      (href) =>
        new URL(href, "http://localhost").searchParams.get("site") ?? "",
    );
    expect([...siteIds].sort()).toEqual([...SITE_IDS].sort());

    for (const siteId of siteIds) {
      await gotoView("site", siteId);
      const values = page
        .getByRole("region", { name: "Site detail", exact: true })
        .getByRole("definition")
        .filter({ hasText: /\d/ });
      const count = await values.count();
      expect(count, `${siteId}: number elements found`).toBeGreaterThan(0);

      for (let i = 0; i < count; i++) {
        const value = values.nth(i);
        const text = (await value.innerText()).trim();
        const origin = value.getByRole("link");
        await expect(origin, `${siteId}: "${text}" has no origin`).toHaveCount(
          1,
        );
        const target = (await origin.getAttribute("href")) ?? "";
        expect(
          target,
          `${siteId}: "${text}" origin should point at an on-page source`,
        ).toMatch(/^#.+/);
        await expect(
          page.locator(`[id="${target.slice(1)}"]`),
          `${siteId}: "${text}" points at ${target}, which is not on the page`,
        ).toHaveCount(1);
      }
    }
  });

  test("a number's origin link jumps to its source note, which carries a date", async ({
    page,
    gotoView,
  }) => {
    await gotoView("site", "montrose");
    const evidence = page.getByRole("complementary", { name: "Evidence" });

    await page.getByRole("link", { name: "8,600" }).click();
    await expect(page).toHaveURL(/#catchment-source$/);
    await expect(evidence.getByText(/Catchment source/)).toBeVisible();
    await expect(evidence.locator("time")).toHaveCount(2);
  });

  test("never shows a single sales forecast figure", async ({
    page,
    gotoView,
  }) => {
    // Guard: nothing on site detail may present sales/revenue/demand as one number.
    // Today the screen has no demand or economics section, so this protects the future one.
    for (const siteId of SITE_IDS) {
      await gotoView("site", siteId);
      const forecastTerms = page
        .getByRole("term")
        .filter({ hasText: /forecast|sales|revenue|demand|profit|cover/i });
      const count = await forecastTerms.count();
      for (let i = 0; i < count; i++) {
        const term = forecastTerms.nth(i);
        const label = (await term.innerText()).trim();
        const value = (
          await term.locator("xpath=following-sibling::dd[1]").innerText()
        ).trim();
        expect(value, `${siteId}: "${label}" must be a range`).toMatch(
          /\d[\d,.]*\s*(?:-|–|—|to)\s*\$?\d|between .+ and /i,
        );
      }
    }
  });

  // HAC-45: an unknown site is a real 404.
  test("an unknown site returns 404", async ({ page }) => {
    const response = await page.goto(
      "/projects/houston-coffee/sites/no-such-site",
    );

    expect(response?.status()).toBe(404);
    await expect(
      page.getByRole("heading", { level: 1, name: "Page not found" }),
    ).toBeVisible();
  });

  for (const siteId of SITE_IDS) {
    test(`${siteId}: has no serious or critical accessibility violations`, async ({
      page,
      gotoView,
    }) => {
      await gotoView("site", siteId);
      await expect(
        page.getByRole("heading", { level: 2, name: SITES[siteId].address }),
      ).toBeVisible();
      await expectNoA11yViolations(page);
    });
  }

  // ---- Behaviour the ticket describes that HAC-21 did not ship -----------------------

  for (const siteId of SITE_IDS) {
    test(`${siteId}: every number names its origin as costar, public, founder or default`, async ({
      page,
      gotoView,
    }) => {
      await gotoView("site", siteId);
      const values = page
        .getByRole("region", { name: "Site detail", exact: true })
        .getByRole("definition")
        .filter({ hasText: /\d/ });
      const count = await values.count();
      expect(count).toBeGreaterThan(0);
      for (let i = 0; i < count; i++) {
        await expect(values.nth(i)).toHaveText(
          /\b(costar|public|founder|default)\b/i,
        );
      }
    });

    test(`${siteId}: demand and economics are shown as ranges`, async ({
      page,
      gotoView,
    }) => {
      test.fixme(
        true,
        "HAC-21 scope: HAC-21 site detail has no demand or economics section yet",
      );
      await gotoView("site", siteId);
      const demand = page.getByRole("region", { name: /demand|economics/i });
      await expect(demand).toBeVisible();
      await expect(demand).toContainText(/\d[\d,.]*\s*(?:-|–|—|to)\s*\$?\d/);
    });
  }
});

test.describe("live site detail", () => {
  test("uses canonical listing and catchment evidence, never fixture numbers", async ({
    page,
  }) => {
    const { mockLiveSites } = await import("./live-site-fixtures");
    await mockLiveSites(page);
    const request = page.waitForRequest((r) => r.url().includes("/catchment?"));
    await page.goto("/projects/houston-coffee/sites/201%3A301");
    const url = new URL((await request).url());
    expect(url.pathname).toBe("/api/sites/201%3A301/catchment");
    expect(url.searchParams.get("projectId")).toBe("houston-coffee");
    expect(url.searchParams.get("category")).toBe("coffee");
    expect(url.searchParams.get("radiusMeters")).toBeNull();
    await expect(
      page.getByRole("heading", { name: "101 Invented St" }),
    ).toBeVisible();
    await expect(
      page
        .getByRole("region", { name: "Site detail", exact: true })
        .getByRole("definition")
        .filter({ hasText: "4,321" }),
    ).toContainText("costar");
    await expect(page.getByText("Residents", { exact: true })).toBeVisible();
    await expect(
      page
        .getByRole("region", { name: "Site detail", exact: true })
        .getByRole("definition")
        .filter({ hasText: /Unknown/ }),
    ).not.toHaveCount(0);
    await expect(
      page.getByText("Synthetic competing café", { exact: false }).first(),
    ).toBeVisible();
    await expect(
      page.getByText("Synthetic Grocery", { exact: false }).first(),
    ).toBeVisible();
    await expect(
      page.getByRole("link", { name: "Source URL" }).first(),
    ).toHaveAttribute("href", "https://example.test/venues");
    await expect(page.getByText("12,400")).toHaveCount(0);
    await expect(
      page
        .getByRole("region", { name: "Site detail", exact: true })
        .getByText("Example data", { exact: true }),
    ).toHaveCount(0);
    const evidenceLinks = page
      .getByRole("region", { name: "Site detail", exact: true })
      .getByRole("definition")
      .getByRole("link");
    for (const link of await evidenceLinks.all()) {
      const href = await link.getAttribute("href");
      expect(href).toMatch(/^#/);
      await expect(
        page.locator(`[id="${decodeURIComponent(href!.slice(1))}"]`),
      ).toHaveCount(1);
    }
    const sizeLink = page
      .getByRole("region", { name: "Site detail", exact: true })
      .getByRole("definition")
      .filter({ hasText: "1,250" })
      .getByRole("link");
    const targetId = decodeURIComponent(
      (await sizeLink.getAttribute("href"))!.slice(1),
    );
    await sizeLink.click();
    await expect(page.locator(`[id="${targetId}"]`)).toBeFocused();
    await expectNoA11yViolations(page);
  });

  test("catchment failure retains listing facts and retries without fabricated demographics", async ({
    page,
  }) => {
    const { mockLiveSites, liveCatchment } =
      await import("./live-site-fixtures");
    await mockLiveSites(page);
    let failed = true;
    await page.route("**/api/sites/*/catchment?*", (route) =>
      failed
        ? route.fulfill({ status: 503, json: {} })
        : route.fulfill({ json: liveCatchment }),
    );
    await page.goto("/projects/houston-coffee/sites/201%3A301");
    await expect(
      page.getByRole("heading", { name: "101 Invented St" }),
    ).toBeVisible();
    await expect(
      page.getByRole("alert").filter({ hasText: /Catchment unavailable/ }),
    ).toBeVisible();
    await expect(
      page
        .getByRole("region", { name: "Site detail", exact: true })
        .getByText("Example data", { exact: true }),
    ).not.toBeVisible();
    await page.getByText("View example site details", { exact: true }).click();
    await expect(
      page
        .getByRole("region", { name: "Site detail", exact: true })
        .getByText("Example data", { exact: true }),
    ).toBeVisible();
    await expect(
      page.getByRole("heading", { name: "Montrose storefront" }),
    ).toBeVisible();
    failed = false;
    await page.getByRole("button", { name: "Retry catchment" }).click();
    await expect(
      page
        .getByRole("region", { name: "Site detail", exact: true })
        .getByRole("definition")
        .filter({ hasText: "4,321" }),
    ).toBeVisible();
  });

  test("unknown live id is unavailable without substituting another candidate", async ({
    page,
  }) => {
    const { mockLiveSites } = await import("./live-site-fixtures");
    await mockLiveSites(page);
    await page.goto("/projects/houston-coffee/sites/999%3A999");
    await expect(
      page.getByText("Site not found in the current search."),
    ).toBeVisible();
    await expect(
      page.getByRole("heading", { name: "101 Invented St" }),
    ).toHaveCount(0);
  });
});

test("live detail treats missing catchment and stalled service as unavailable", async ({
  page,
}) => {
  const { mockLiveSites } = await import("./live-site-fixtures");
  await mockLiveSites(page);
  await page.route("**/api/sites/*/catchment?*", (route) =>
    route.fulfill({ status: 404, json: {} }),
  );
  await page.goto("/projects/houston-coffee/sites/201%3A301");
  await expect(
    page.getByRole("alert").filter({ hasText: /this site was not found/ }),
  ).toBeVisible();
  await page.clock.install();
  await page.route("**/api/sites/*/catchment?*", () => new Promise(() => {}));
  const request = page.waitForRequest((r) => r.url().includes("/catchment?"));
  await page.getByRole("button", { name: "Retry catchment" }).click();
  await request;
  await page.clock.fastForward(15_001);
  await expect(
    page.getByRole("alert").filter({ hasText: /Catchment unavailable/ }),
  ).toBeVisible();
  await expect(
    page.getByRole("heading", { name: "101 Invented St" }),
  ).toBeVisible();
});

test("live detail without intake explains example fallback and malformed IDs remain 404", async ({
  page,
}) => {
  await page.goto("/projects/houston-coffee/sites/201%3A301");
  await expect(
    page.getByText(/requested listing cannot be verified/),
  ).toBeVisible();
  await page.getByText("View example site details", { exact: true }).click();
  await expect(
    page
      .getByRole("region", { name: "Site detail", exact: true })
      .getByText("Example data", { exact: true }),
  ).toBeVisible();
  await expect(
    page.getByRole("heading", { name: "Montrose storefront" }),
  ).toBeVisible();
  for (const path of [
    "/projects/houston-coffee/sites/201%253A301",
    "/projects/no-such-project/sites/201%3A301",
  ]) {
    const response = await page.goto(path);
    expect(response?.status()).toBe(404);
  }
});

test("monthly costs render dollars with provenance rather than raw cents", async ({
  page,
}) => {
  const { mockLiveSites, liveSearch } = await import("./live-site-fixtures");
  await mockLiveSites(page);
  const result = structuredClone(liveSearch);
  result.candidates[0].baseRentCents.value = 240000;
  result.candidates[0].opexCents.value = 120000;
  result.candidates[0].totalMonthlyCostCents.value = 360000;
  await page.route("**/api/sites", (route) => route.fulfill({ json: result }));
  await page.goto("/projects/houston-coffee/sites/201%3A301");
  await expect(
    page.getByRole("link", { name: "$2,400 / month costar", exact: true }),
  ).toBeVisible();
  await expect(
    page.getByRole("link", { name: "$1,200 / month costar", exact: true }),
  ).toBeVisible();
  await expect(
    page.getByRole("link", { name: "$3,600 / month costar", exact: true }),
  ).toBeVisible();
  await expect(
    page
      .getByRole("region", { name: "Site detail", exact: true })
      .getByRole("definition")
      .filter({ hasText: "USD cents" }),
  ).toHaveCount(0);
});
