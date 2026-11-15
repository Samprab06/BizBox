import { expect, test } from "./fixtures";

test.beforeEach(async ({ page }) => {
  await page.route("**/api/vexcel/**", (route) => route.abort());
  await page.route("**/matterport/**", (route) => route.abort());
});

test("HAC-93: the inspector keeps one customer across scenarios, hides later outcomes on seek back and works by keyboard", async ({
  page,
}) => {
  await page.goto("/projects/houston-coffee/simulator#operating-plan");
  const playback = page.getByRole("group", {
    name: "Shared playback",
    exact: true,
  });
  const seek = playback.getByRole("slider", { name: "Time of day" });
  await seek.focus();
  await seek.press("End");
  const panel = page.getByRole("region", { name: "Inspect customers" });
  await panel.getByLabel("Search customers").fill("customer-1");
  await panel.getByLabel("Inspect a customer").selectOption("customer-1");
  const activity = panel.getByRole("status", { name: "Customer activity" });
  await expect(activity).toContainText("customer-1");
  const outcome = panel
    .getByRole("term")
    .filter({ hasText: "Outcome" })
    .locator("..")
    .getByRole("definition");
  await expect(outcome).not.toContainText("Not decided yet");

  // Same customer in the other scenario.
  await panel.getByLabel("Scenario").selectOption({ index: 1 });
  await expect(activity).toContainText("customer-1");
  await expect(activity).toContainText("Two staffed counters");

  // Seeking to opening shows no outcome from later in the day.
  await seek.focus();
  await seek.press("Home");
  await expect(
    panel.getByText(/has not arrived by|Not decided yet/),
  ).toBeVisible();

  // Escape clears the selection from inside the panel.
  await panel.getByLabel("Inspect a customer").focus();
  await page.keyboard.press("Escape");
  await expect(panel.getByLabel("Inspect a customer")).toHaveValue("");
});
