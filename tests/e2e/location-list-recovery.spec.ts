import { expect, test } from "./fixtures";
import { mockLiveComparison, threeSiteComparison, threeSiteIds, threeSiteSearch } from "./live-comparison-fixtures";

// Invented listings and intercepted services only; no model, inventory or Jev calls.
test.use({ viewport: { width: 1440, height: 960 } });

for (const city of ["Houston", "Los Angeles"] as const) {
  test(`${city}: stale top picks cannot hide available comparison choices`, async ({ page }) => {
    await mockLiveComparison(page);
    const inventory = structuredClone(threeSiteSearch);
    const extras = Array.from({ length: 5 }, (_, index) => {
      const entry = structuredClone(inventory.candidates[0]);
      entry.candidate.id = `90${index}:80${index}`;
      entry.candidate.address = `${400 + index} Invented Road`;
      entry.propertyId = `70${index}`;
      entry.listingId = `90${index}`;
      return entry;
    });
    inventory.candidates.splice(2, 0, ...extras);
    inventory.candidates.forEach(entry => { entry.candidate.city = city; });
    inventory.totalMatched = 190;
    await page.addInitScript(({ city, survivor }) => {
      const key = "sitework:intake:v1:houston-coffee";
      const session = JSON.parse(localStorage.getItem(key)!);
      session.profile.city = { value: city, origin: "founder" };
      localStorage.setItem(key, JSON.stringify(session));
      localStorage.setItem("bizbox:top-sites:v1:houston-coffee", JSON.stringify(["old:1", "old:2", survivor]));
      localStorage.setItem("bizbox:workspace-greeted:v1:houston-coffee", "1");
    }, { city, survivor: threeSiteIds[0] });
    await page.route("**/api/sites", route => route.fulfill({ json: inventory }));
    await page.route("**/api/projects/*/intake", route => route.fulfill({
      json: route.request().method() === "GET"
        ? { modelConfigured: false }
        : { draft: {}, assumptions: {}, missingRequiredFields: [], findings: [], assistantMessage: "" },
    }));
    const compared: string[][] = [];
    await page.route("**/api/comparisons", route => {
      const ids = route.request().postDataJSON().candidateIds;
      compared.push(ids);
      return route.fulfill({ status: 201, json: threeSiteComparison(ids) });
    });
    await page.goto("/projects/houston-coffee/workspace?step=locations");
    const top = page.getByRole("region", { name: "Top locations", exact: true });
    await expect(top.getByRole("listitem")).toHaveCount(3);
    await page.getByRole("button", { name: "Show list (8 units)", exact: true }).click();
    const list = page.getByRole("region", { name: "Location list", exact: true });
    await expect(list.getByRole("checkbox")).toHaveCount(8);
    await expect(list).toContainText("8 of 190 matching units shown");
    // One choice is outside the top three, so the full list must remain actionable.
    await list.getByRole("checkbox", { name: /Compare 101 Invented St/ }).check();
    await list.getByRole("checkbox", { name: /Compare 303 Invented Ave/ }).check();
    await page.getByRole("region", { name: "Comparison shortlist" })
      .getByRole("button", { name: "Compare 2 units", exact: true }).click();
    await page.getByRole("button", { name: "Run comparison", exact: true }).click();
    await expect(page).toHaveURL(/step=results/);
    expect(compared).toEqual([[threeSiteIds[0], threeSiteIds[2]]]);
  });
}
