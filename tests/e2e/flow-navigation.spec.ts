import { expect, test } from "./fixtures";
import { completeIntake, liveSearch } from "./live-site-fixtures";

const progress = (page: import("@playwright/test").Page) =>
  page.getByRole("navigation", { name: "Progress" });
const step = (page: import("@playwright/test").Page, id: string) =>
  progress(page).locator(`[data-flow-step="${id}"]`);

test("a new founder sees one guided navigation with later steps locked", async ({ page }) => {
  await page.goto("/projects/houston-coffee/intake");
  await expect(progress(page).locator("[data-flow-step]")).toHaveCount(6);
  await expect(step(page, "questions")).toHaveAttribute("data-flow-status", "current");
  await expect(step(page, "questions").getByRole("link")).toHaveAttribute(
    "aria-current", "step",
  );
  for (const id of ["locations", "compare", "results", "interior", "finalize"]) {
    await expect(step(page, id)).toHaveAttribute("data-flow-status", "locked");
    await expect(step(page, id).getByRole("link")).toHaveCount(0);
    await expect(step(page, id).locator("[aria-disabled=true]")).toHaveCount(1);
  }
  await expect(page.getByRole("navigation", { name: "Project views" })).toHaveCount(0);
  await expect(page.getByRole("complementary", { name: "Project context" })).toHaveCount(0);
});

test("reached steps are links, and back/forward track the current step", async ({ page }) => {
  await page.goto("/projects/houston-coffee/intake");
  await page.evaluate(() => {
    localStorage.setItem("bizbox:flow:v1:houston-coffee", JSON.stringify({
      reached: ["questions", "locations", "compare"],
      siteTweaks: {},
      finalPlan: null,
    }));
  });
  await page.reload();
  await expect(step(page, "locations").getByRole("link")).toHaveAttribute(
    "href", "/projects/houston-coffee/workspace?step=locations",
  );
  await step(page, "locations").getByRole("link").click();
  await expect(page).toHaveURL(/\/workspace\?step=locations$/);
  await expect(step(page, "locations")).toHaveAttribute("data-flow-status", "current");
  await expect(step(page, "compare")).toHaveAttribute("data-flow-status", "reached");
  await step(page, "questions").getByRole("link").click();
  await expect(page).toHaveURL(/\/intake$/);
  await page.goBack();
  await expect(step(page, "locations")).toHaveAttribute("data-flow-status", "current");
  await page.goForward();
  await expect(step(page, "questions")).toHaveAttribute("data-flow-status", "current");
});

test("the location step never silently selects a fixture, and examples are labelled", async ({ page }) => {
  await completeIntake(page);
  const listings = structuredClone(liveSearch);
  for (const entry of listings.candidates) entry.candidate.synthetic = false;
  await page.route("**/api/sites", (route) => route.fulfill({ json: listings }));
  await page.route("**/api/projects/*/intake", (route) =>
    route.fulfill({ json: { modelConfigured: false } }),
  );
  await page.goto("/projects/houston-coffee/workspace?step=locations");
  await expect(step(page, "locations")).toHaveAttribute("data-flow-status", "current");
  await expect(page.getByRole("region", { name: "Selected location" })).toHaveCount(0);
  await page.getByRole("button", { name: /^Show list/ }).click();
  await expect(page.getByRole("group", { name: "Matching locations" })).toBeVisible();
  await expect(page.getByRole("button", { name: /^View 101 Invented St/ })).toBeVisible();
  await page.route("**/api/sites", (route) => route.fulfill({ status: 503, json: {} }));
  await page.goto("/projects/houston-coffee/map");
  await expect(page.getByRole("region", { name: "Candidate locations" }).getByText("Example data", { exact: true })).toBeVisible();
});
