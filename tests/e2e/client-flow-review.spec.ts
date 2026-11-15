import { expect, test } from "./fixtures";

test("retired review opens the real workspace without sample controls", async ({ page }) => {
  await page.goto("/review/client-flow");
  await expect(page).toHaveURL(/\/projects\/houston-coffee\/workspace$/);
  await expect(page.getByText("Preview state", { exact: true })).toHaveCount(0);
  await expect(page.getByText("Reset review", { exact: true })).toHaveCount(0);
  await expect(page.getByText("Sample data · Review only", { exact: true })).toHaveCount(0);
});
