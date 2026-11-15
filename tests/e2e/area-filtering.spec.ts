import { test, expect } from "./fixtures";
import { completeIntake } from "./live-site-fixtures";
import { normalizeProperty, normalizeSpaces } from "../../lib/data/costar";
import { searchSites } from "../../lib/data/sites";
import { writeAreaMap } from "../../components/onboarding/area-map-data";
import { SiteSearchRequestSchema } from "../../lib/contracts/sites";

const enums = {
  PropertyType: { "2": "GeneralRetail" },
  SpaceUse: { "5": "Retail" },
  FloorName: { "23": "Ground" },
  SpacePosition: { "2": "Inline" },
};
// Invented full inventory. The browser calls the real filtering function via a
// mocked transport; no licensed inventory, DB write, model or Jev call is used.
const places = [
  { id: 101, name: "Red", lng: -95.4, rate: 15 },
  { id: 202, name: "Green", lng: -95.3, rate: 36 },
  { id: 303, name: "Outside", lng: -95.2, rate: 18 },
];
const inventory = {
  properties: places.map((p) =>
    normalizeProperty(
      {
        id: p.id,
        propertyType: 2,
        primaryAddress: {
          city: "Houston",
          streetNumber: String(p.id),
          streetName: p.name,
          streetType: "St",
          latitude: 29.7,
          longitude: p.lng,
        },
      },
      enums,
    ),
  ),
  spaces: places.flatMap((p) =>
    normalizeSpaces(
      {
        id: p.id + 1000,
        propertyId: p.id,
        listingStatus: 1,
        forLeaseSummary: {
          askingRateMeasurementType: 1,
          spaces: [
            {
              id: 1,
              spaceUse: 5,
              squareFeetMax: 1200,
              rateHigh: p.rate,
              rateBasis: 2,
              monetaryUnit: 1,
              floorName: 23,
              spacePosition: 2,
            },
          ],
        },
      },
      enums,
    ),
  ),
  tenancies: [],
  synthetic: false,
};

test("saved rectangles prioritize green, exclude red and clear without stale exclusions", async ({
  page,
}) => {
  await completeIntake(page);
  const areas = writeAreaMap([], "Houston", "", [
    { bounds: [-95.41, 29.69, -95.39, 29.71], brush: "avoid" },
    { bounds: [-95.31, 29.69, -95.29, 29.71], brush: "favor" },
  ]);
  await page.addInitScript((value) => {
    const key = "sitework:intake:v1:houston-coffee";
    const saved = JSON.parse(localStorage.getItem(key)!);
    saved.profile.areas = { value, origin: "founder" };
    localStorage.setItem(key, JSON.stringify(saved));
  }, areas);
  const results: ReturnType<typeof searchSites>[] = [];
  await page.route("**/api/sites", async (route) => {
    const input = SiteSearchRequestSchema.parse(route.request().postDataJSON());
    const result = searchSites(input, inventory);
    results.push(result);
    await route.fulfill({ json: result });
  });
  await page.route("**/api/projects/*/intake", (route) =>
    route.fulfill({
      json:
        route.request().method() === "GET"
          ? { modelConfigured: false }
          : {
              draft: {},
              assumptions: {},
              missingRequiredFields: [],
              findings: [],
              nextQuestion: null,
              assistantMessage: "",
              actions: [],
            },
    }),
  );
  await page.route("**/api/comparisons/capabilities", (route) =>
    route.fulfill({ json: { jevConfigured: false } }),
  );
  await page.route("**/api/voice/session", (route) =>
    route.fulfill({ json: { configured: false } }),
  );
  await page.goto("/projects/houston-coffee/workspace?step=locations");
  const list = page.getByRole("region", { name: "Top locations", exact: true });
  await expect(
    list.getByRole("button", { name: /Top 1: view 202 Green/ }),
  ).toBeVisible();
  await expect(
    list.getByRole("button", { name: /view 303 Outside/ }),
  ).toBeVisible();
  await expect(list.getByRole("button", { name: /view 101 Red/ })).toHaveCount(
    0,
  );
  expect(results.at(-1)?.totalMatched).toBe(2);
  await page.evaluate(() => {
    const key = "sitework:intake:v1:houston-coffee";
    const saved = JSON.parse(localStorage.getItem(key)!);
    saved.profile.areas = { value: "No preference", origin: "founder" };
    localStorage.setItem(key, JSON.stringify(saved));
    window.dispatchEvent(
      new CustomEvent("sitework:intake-updated", { detail: { key } }),
    );
  });
  await expect(
    list.getByRole("button", { name: /view 101 Red/ }),
  ).toBeVisible();
  expect(results.at(-1)?.totalMatched).toBe(3);
  expect(
    results
      .at(-1)
      ?.candidates.every((c) => !c.flags.includes("preferred_area")),
  ).toBe(true);
});
