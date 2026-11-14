import type { Page } from "@playwright/test";
import { expect, expectNoA11yViolations, test } from "./fixtures";
import {
  mockLiveComparison,
  liveComparisonSearch,
  liveComparisonPayload,
  liveComparisonId,
  comparisonForCandidates,
} from "./live-comparison-fixtures";

// Invented API test responses exercise the production source branches. These are not
// vendor data or evidence that live inventory, imagery, scans or Jev were verified.
async function services(page: Page) {
  await mockLiveComparison(page);
  const search = structuredClone(liveComparisonSearch);
  for (const entry of search.candidates) entry.candidate.synthetic = false;
  await page.route("**/api/sites", (r) => r.fulfill({ json: search }));
  await page.route("**/api/projects/*/intake", (r) =>
    r.fulfill({ json: { modelConfigured: false } }),
  );
  await page.route("**/api/voice/session", (r) =>
    r.fulfill({ json: { configured: false } }),
  );
  const posts: string[][] = [];
  await page.route("**/api/comparisons", (r) => {
    const ids = r.request().postDataJSON().candidateIds as string[];
    posts.push(ids);
    const result = comparisonForCandidates(ids);
    result.comparison.synthetic = false;
    return r.fulfill({ status: 201, json: result });
  });
  await page.route(`**/api/comparisons/${liveComparisonId}?*`, (r) =>
    r.fulfill({
      json: {
        ...liveComparisonPayload,
        comparison: { ...liveComparisonPayload.comparison, synthetic: false },
      },
    }),
  );
  await page.route("**/api/sites/*/interior", (r) =>
    r.fulfill({
      json: {
        kind: "modeled",
        provenance: {
          origin: "default",
          provider: "modeled",
          mode: "live",
          scope: "space",
          description: "No verified scan exists for this selected suite.",
          limitations: [],
        },
      },
    }),
  );
  return { posts, search };
}

for (const viewport of [
  { width: 1366, height: 900 },
  { width: 820, height: 1180 },
  { width: 390, height: 844 },
]) {
  test.describe(`client flow ${viewport.width}`, () => {
    test.use({ viewport });
    test("real-source selection, explicit comparison and interior keep the same conversation", async ({
      page,
    }) => {
      const { posts } = await services(page);
      await page.goto("/projects/houston-coffee/workspace");
      const locations = page.getByRole("group", { name: "Matching locations" });
      await expect(
        locations.getByRole("button", { name: "View 101 Invented St" }),
      ).toBeVisible();
      await expect(
        page.getByRole("region", { name: "Selected location" }),
      ).toContainText("101 Invented St");
      await expect(
        page.getByText("City preview · photo, not a map"),
      ).toHaveCount(0);
      expect(posts).toHaveLength(0);
      const composer = page.getByRole("textbox", {
        name: "Message the BizBox assistant",
      });
      await composer.fill("Keep this question while I explore");
      await locations
        .getByRole("button", { name: "View 202 Invented St" })
        .click();
      await expect(page).toHaveURL(/site=202%3A302/);
      await expect(
        page.getByRole("region", { name: "Selected location" }),
      ).toContainText("202 Invented St");
      await page
        .getByRole("button", { name: "View interior", exact: true })
        .click();
      await expect(
        page.getByRole("heading", {
          name: "Interior unavailable",
          exact: true,
        }),
      ).toBeVisible();
      await expect(composer).toHaveValue("Keep this question while I explore");
      await page.getByRole("tab", { name: "Voice", exact: true }).click();
      await expect(
        page.getByRole("region", { name: "Voice assistant" }),
      ).toBeVisible();
      await expect(
        page.getByRole("button", { name: "Start voice", exact: true }),
      ).toBeDisabled();
      await page.getByRole("tab", { name: "Text", exact: true }).click();
      await expect(composer).toHaveValue("Keep this question while I explore");
      await page
        .getByRole("button", { name: "Locations", exact: true })
        .click();
      await page
        .getByRole("button", { name: "Compare locations", exact: true })
        .click();
      await expect(
        page.getByRole("region", { name: "Location comparison results" }),
      ).toBeVisible();
      expect(posts).toEqual([["201:301", "202:302"]]);
      await page
        .getByRole("region", { name: "Location comparison results" })
        .getByText("Details", { exact: true })
        .click();
      await expect(
        page.getByText("Modeled estimates · Huff fallback.", { exact: false }),
      ).toBeVisible();
      await expect(
        page.getByRole("button", { name: /Run baseline/ }),
      ).toHaveCount(0);
      await locations
        .getByRole("checkbox", { name: "Compare 202 Invented St" })
        .uncheck();
      await expect(
        page.getByRole("region", { name: "Location comparison results" }),
      ).toHaveCount(0);
      await expect(
        page.getByRole("button", { name: "Compare locations", exact: true }),
      ).toBeDisabled();
      await expect(composer).toHaveValue("Keep this question while I explore");
      expect(
        await page.evaluate(
          () => document.documentElement.scrollWidth <= innerWidth,
        ),
      ).toBe(true);
      await expectNoA11yViolations(page);
    });
  });
}

test("only a matching non-demo registry scan can mount the Matterport view", async ({
  page,
}) => {
  await services(page);
  await page.route("https://my.matterport.com/**", (r) =>
    r.fulfill({
      contentType: "text/html",
      body: "<!doctype html><title>Mocked viewer</title><p>Test viewer boundary</p>",
    }),
  );
  await page.route("**/api/sites/*/interior", (r) =>
    r.fulfill({
      json: {
        kind: "scan",
        modelId: "TestScan001",
        provenance: {
          origin: "matterport",
          provider: "matterport",
          mode: "live",
          scope: "space",
          description: "Matched test registry entry.",
          limitations: [],
        },
      },
    }),
  );
  await page.goto("/projects/houston-coffee/workspace");
  await expect(
    page.getByRole("button", { name: "View interior", exact: true }),
  ).toBeVisible();
  await page
    .getByRole("button", { name: "View interior", exact: true })
    .click();
  await expect(
    page.locator('iframe[title="Matterport interior for 101 Invented St"]'),
  ).toHaveAttribute("src", /my\.matterport\.com\/show\/\?m=TestScan001/);
  await expect(
    page.getByText("Interior details", { exact: true }),
  ).toBeVisible();
});

test("unavailable inventory never substitutes example properties", async ({
  page,
}) => {
  await services(page);
  await page.route("**/api/sites", (r) => r.fulfill({ status: 503, json: {} }));
  await page.goto("/projects/houston-coffee/workspace");
  await expect(
    page.getByText("No spaces available", { exact: true }),
  ).toBeVisible();
  await expect(
    page.getByRole("group", { name: "Matching locations" }),
  ).toHaveCount(0);
  await expect(
    page.getByRole("button", { name: "Compare locations", exact: true }),
  ).toBeDisabled();
  await expect(
    page.getByText("Montrose storefront", { exact: true }),
  ).toHaveCount(0);
});
