import { test, expect, type Page } from "@playwright/test";
import {
  threeSiteComparison,
  threeSiteIds,
  threeSiteSearch,
} from "./live-comparison-fixtures";

// All external APIs are intercepted. Geometry/decisions/results use the actual local spatial engine.
const cities = ["Houston", "Los Angeles"] as const;
const comparisonId = "interior-browser-comparison";

async function setup(
  page: Page,
  city: string,
  category: string,
  liveMatterport = false,
) {
  const session = {
    profile: Object.fromEntries(
      Object.entries({
        concept: `${category} business`,
        category,
        city,
        areas: "Any",
        rent: "5000",
        buildout: "60000",
        price: "Midrange",
        customers: "Neighbors",
        hours: "8am-12pm",
        staff: "2",
        requirements: "None",
      }).map(([key, value]) => [key, { value, origin: "founder" }]),
    ),
    messages: [],
  };
  await page.addInitScript(
    ({ session, ids }) => {
      if (!localStorage.getItem("interior-test-seeded")) {
        localStorage.setItem(
          "sitework:intake:v1:houston-coffee",
          JSON.stringify(session),
        );
        localStorage.setItem(
          "sitework:shortlist:v1:houston-coffee",
          JSON.stringify(ids),
        );
        localStorage.setItem(
          "bizbox:flow:v1:houston-coffee",
          JSON.stringify({
            reached: ["questions", "locations", "compare", "results"],
            siteTweaks: {},
            finalPlan: null,
          }),
        );
        localStorage.setItem("bizbox:workspace-greeted:v1:houston-coffee", "1");
        localStorage.setItem("interior-test-seeded", "1");
      }
    },
    { session, ids: [...threeSiteIds] },
  );
  await page.route("**/api/sites", (route) =>
    route.fulfill({ json: threeSiteSearch }),
  );
  await page.route("**/api/comparisons/capabilities", (route) =>
    route.fulfill({ json: { jevConfigured: false } }),
  );
  await page.route(`**/api/comparisons/${comparisonId}*`, (route) =>
    route.fulfill({ json: threeSiteComparison(threeSiteIds, comparisonId) }),
  );
  await page.route(`**/api/comparisons/${comparisonId}/plan*`, (route) =>
    route.fulfill({ status: 404, json: {} }),
  );
  await page.route("**/api/voice/session", (route) =>
    route.fulfill({ json: { configured: false } }),
  );
  await page.route("**/api/projects/*/intake", (route) =>
    route.fulfill({
      json:
        route.request().method() === "GET"
          ? { modelConfigured: false }
          : {
              persisted: false,
              draft: {},
              assumptions: {},
              profile: null,
              missingRequiredFields: [],
              findings: [],
              questions: [],
              nextQuestion: null,
              defaultSources: [],
              assistantMessage: "Local test consultant.",
            },
    }),
  );
  await page.route("**/api/projects/*/station-experiments?*", (route) =>
    route.fulfill({
      json: { status: "unavailable", reason: "No recorded experiment" },
    }),
  );
  await page.route("**/api/sites/*/interior", (route) =>
    route.fulfill({ status: 404, json: {} }),
  );
  if (!liveMatterport)
    await page.route("https://**/*", (route) => route.abort());
  await page.goto(
    `/projects/houston-coffee/workspace?step=results&comparison=${comparisonId}`,
  );
}

test.use({ viewport: { width: 1440, height: 1000 } });
for (const city of cities) {
  test(`${city}: selected Matterport is primary and has no modeled or catalog view`, async ({
    page,
  }) => {
    await setup(page, city, "Coffee shop");
    await page.route("**/api/sites/*/interior", (route) =>
      route.fulfill({
        json: {
          kind: "scan",
          modelId: city === "Houston" ? "Synthetic01" : "Synthetic02",
          provenance: {
            origin: "costar",
            provider: "matterport",
            mode: "live",
            scope: "property",
            description: "Controlled selected-source response",
            limitations: ["No suite measurement"],
          },
        },
      }),
    );
    await page
      .getByRole("button", { name: /^Choose 101 Invented St/ })
      .first()
      .click();
    const stage = page.getByRole("region", {
      name: "Selected building interior",
    });
    await expect(stage.locator("iframe")).toBeVisible();
    await expect(stage.locator("iframe")).toHaveAttribute(
      "src",
      new RegExp(`m=${city === "Houston" ? "Synthetic01" : "Synthetic02"}`),
    );
    await expect(
      stage.getByRole("button", { name: "Experiment layout", exact: true }),
    ).toHaveCount(0);
    await expect(
      stage.getByRole("button", { name: "3D furniture", exact: true }),
    ).toHaveCount(0);
    await expect(
      stage.getByText("Furniture catalog", { exact: true }),
    ).toHaveCount(0);
    await expect(
      stage.locator("canvas,svg[aria-label='Proposed interior floor plan']"),
    ).toHaveCount(0);
  });
}
test("unavailable selected source never substitutes a modeled room", async ({
  page,
}) => {
  await setup(page, "Los Angeles", "Coffee shop");
  await page
    .getByRole("button", { name: /^Choose 101 Invented St/ })
    .first()
    .click();
  const stage = page.getByRole("region", {
    name: "Selected building interior",
  });
  await expect(stage).toContainText("No viewable interior is available");
  await expect(stage.locator("iframe,canvas")).toHaveCount(0);
  await expect(
    stage.getByText("Furniture catalog", { exact: true }),
  ).toHaveCount(0);
});
