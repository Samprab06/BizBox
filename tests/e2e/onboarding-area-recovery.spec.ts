import { expect, test } from "./fixtures";
import { completeIntake, liveSearch } from "./live-site-fixtures";
import { mapMarker, writeAreaMap } from "../../components/onboarding/area-map-data";

// Saved browser criteria and network responses are invented; no model or database calls.
const key = "sitework:intake:v1:houston-coffee";
const rectangles = {
  Houston: [{ bounds: [-95.5, 29.6, -95.3, 29.8] as [number, number, number, number], brush: "avoid" as const }],
  "Los Angeles": [{ bounds: [-118.4, 34, -118.2, 34.1] as [number, number, number, number], brush: "favor" as const }],
};

test.use({ viewport: { width: 1440, height: 960 } });

test.beforeEach(async ({ page }) => {
  await completeIntake(page);
  await page.route("**/api/projects/*/intake", route => route.fulfill({ json: { modelConfigured: false } }));
  await page.route("**/api/voice/session", route => route.fulfill({ json: { configured: false } }));
  await page.route("**/api/comparisons/capabilities", route => route.fulfill({ json: { jevConfigured: false } }));
});

for (const city of ["Houston", "Los Angeles"] as const) {
  test(`${city} onboarding preserves its saved map and sends matching criteria to search`, async ({ page }) => {
    const areaValue = writeAreaMap([], city, "near transit", rectangles[city]);
    await page.addInitScript(({ key, city, areaValue }) => {
      const session = JSON.parse(localStorage.getItem(key)!);
      session.profile.city = { value: city, origin: "founder" };
      session.profile.areas = { value: areaValue, origin: "founder" };
      localStorage.setItem(key, JSON.stringify(session));
    }, { key, city, areaValue });
    const requests: { profile: { city: string; areaPreferences: unknown } }[] = [];
    await page.route("**/api/sites", route => {
      requests.push(route.request().postDataJSON());
      return route.fulfill({ json: { ...liveSearch, candidates: [], totalMatched: 0 } });
    });
    await page.goto("/projects/houston-coffee/intake");
    await expect(page.locator("#onboarding-title")).toHaveText("Review your business");
    await page.getByRole("link", { name: /Find my locations/ }).click();
    await expect.poll(() => requests.length).toBeGreaterThan(0);
    expect(requests[0].profile).toMatchObject({ city, areaPreferences: { city, rectangles: rectangles[city] } });
  });
}

for (const damaged of [false, true]) {
  test(`saved ${damaged ? "damaged" : "different-city"} map opens repair without resetting the brief`, async ({ page }) => {
    const areaValue = damaged ? "Old selection" + mapMarker + "bad" : writeAreaMap([], "Los Angeles", "near transit", rectangles["Los Angeles"]);
    await page.addInitScript(({ key, areaValue }) => {
      const session = JSON.parse(localStorage.getItem(key)!);
      session.profile.areas = { value: areaValue, origin: "founder" };
      localStorage.setItem(key, JSON.stringify(session));
    }, { key, areaValue });
    await page.goto("/projects/houston-coffee/intake");
    await expect(page.locator("#onboarding-title")).toHaveText("Which areas should we favor or avoid?");
    await expect(page.getByRole("region", { name: "Which areas should we favor or avoid?" }).getByRole("alert")).toContainText(damaged ? "redraw" : "Los Angeles");
    await expect(page.getByRole("link", { name: /Find my locations/ })).toHaveCount(0);
    const before = await page.evaluate(key => JSON.parse(localStorage.getItem(key)!).profile, key);
    expect(before.areas.value).toBe(areaValue);
    await page.getByRole("button", { name: "Skip", exact: true }).click();
    await expect(page.locator("#onboarding-title")).toHaveText("Review your business");
    const after = await page.evaluate(key => JSON.parse(localStorage.getItem(key)!).profile, key);
    expect(after).toEqual({ ...before, areas: { value: "No preference", origin: "founder" } });
    await expect(page.getByRole("link", { name: /Find my locations/ })).toBeVisible();
  });
}
