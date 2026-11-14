import type { View } from "../../lib/client/workspace-routes";
import { expect, test } from "./fixtures";

test("/ redirects to the example project intake", async ({ page }) => {
  await page.goto("/");
  await expect(page).toHaveURL(/\/projects\/houston-coffee\/intake$/);
});

// Each view's <h1>, as rendered by components/workspace-view.tsx.
const views: { view: View; siteId?: string; heading: string }[] = [
  { view: "intake", heading: "Intake" },
  { view: "map", heading: "Map" },
  { view: "site", siteId: "montrose", heading: "Site detail" },
  { view: "comparison", heading: "Comparison" },
  { view: "replay", heading: "Replay" },
];

for (const { view, siteId, heading } of views) {
  test(`${view} view renders its heading with no console errors`, async ({ page, gotoView }) => {
    const errors: string[] = [];
    page.on("console", (message) => {
      if (message.type() === "error") errors.push(message.text());
    });
    page.on("pageerror", (error) => errors.push(error.message));

    await gotoView(view, siteId);

    await expect(page.getByRole("heading", { level: 1, name: heading })).toBeVisible();
    expect(errors).toEqual([]);
  });
}
