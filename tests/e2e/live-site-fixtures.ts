import type { Page } from "@playwright/test";
import { syntheticHoustonFixture } from "../../fixtures/houston-coffee";
import { searchSites } from "../../lib/data/sites";
import { normalizeProperty, normalizeSpaces } from "../../lib/data/costar";
import { buildCatchment } from "../../lib/data/catchments";

// Invented normalized observations, never licensed inventory or network/model calls.
const enums = {
  PropertyType: { "2": "GeneralRetail" },
  SpaceUse: { "5": "Retail" },
  FloorName: { "23": "Ground" },
  SpacePosition: { "2": "Inline" },
};
const property = normalizeProperty(
  {
    id: 101,
    propertyType: 2,
    buildingName: "Synthetic live café",
    primaryAddress: {
      city: "Houston",
      streetNumber: "101",
      streetName: "Invented",
      streetType: "St",
      latitude: 29.76,
      longitude: -95.37,
    },
  },
  enums,
);
const spaces = normalizeSpaces(
  {
    id: 201,
    propertyId: 101,
    listingStatus: 1,
    forLeaseSummary: {
      spaces: [
        {
          id: 301,
          spaceUse: 5,
          squareFeetMax: 1250,
          floorName: 23,
          spacePosition: 2,
        },
      ],
    },
  },
  enums,
);
const profile = structuredClone(syntheticHoustonFixture.profile);
profile.projectId = "houston-coffee";
for (const flag of Object.values(profile.mustHaves)) flag.value = false;
export const liveSearch = searchSites(
  { profile },
  { properties: [property], spaces, tenancies: [], synthetic: true },
);
export const liveSiteId = "201:301";
export const liveCatchment = buildCatchment({
  site: {
    id: liveSiteId,
    propertyId: "101",
    projectId: "houston-coffee",
    city: "Houston",
    latitude: 29.76,
    longitude: -95.37,
    frontage: [{ trafficCount: 4321 }],
    source: {},
  },
  radiusMeters: 1000,
  radiusOrigin: "default",
  category: "coffee",
  retrievedAt: "2026-11-14T00:00:00Z",
  residents: [],
  workers: [],
  venues: [
    {
      id: "v1",
      name: "Synthetic competing café",
      category: "coffee",
      latitude: 29.761,
      longitude: -95.37,
      origin: "public",
      source: {
        dataset: "Synthetic public test",
        url: "https://example.test/venues",
        retrievedAt: "2026-11-14T00:00:00Z",
      },
    },
  ],
  coTenants: [
    {
      id: "t1",
      name: "Synthetic Grocery",
      industry: "grocery",
      occupiedSqFt: 21000,
      source: {},
    },
  ],
});

export async function completeIntake(page: Page) {
  await page.addInitScript(() => {
    const values = {
      concept: "Neighborhood coffee",
      category: "Coffee shop",
      city: "Houston",
      areas: "Any",
      rent: "5000",
      buildout: "60000",
      price: "Midrange",
      customers: "Neighbors",
      hours: "7am-7pm",
      staff: "2",
      requirements: "None",
    };
    localStorage.setItem(
      "sitework:intake:v1:houston-coffee",
      JSON.stringify({
        profile: Object.fromEntries(
          Object.entries(values).map(([key, value]) => [
            key,
            { value, origin: "founder" },
          ]),
        ),
        messages: [],
      }),
    );
  });
}

export async function mockLiveSites(page: Page) {
  await completeIntake(page);
  await page.route("**/api/sites", (route) =>
    route.fulfill({ json: liveSearch }),
  );
  await page.route("**/api/sites/*/catchment?*", (route) =>
    route.fulfill({ json: liveCatchment }),
  );
}
