import { expect, test } from "./fixtures";
import { makeDemo } from "../../components/simulator/fixture";

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
  await expect(activity).toContainText("Customer 1");
  const outcome = panel
    .getByRole("term")
    .filter({ hasText: "Outcome" })
    .locator("..")
    .getByRole("definition");
  await expect(outcome).not.toContainText("Not decided yet");

  // Same customer in the other scenario.
  await panel.getByLabel("Scenario").selectOption({ index: 1 });
  await expect(activity).toContainText("Customer 1");
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

test("HAC-165: departure stays fixed as playback advances and customer labels are readable", async ({
  page,
}) => {
  const done = makeDemo()[0].run.events.find(
    (event) => event.type === "completion",
  )!;
  await page.goto("/projects/houston-coffee/simulator#operating-plan");
  const seek = page
    .getByRole("group", { name: "Shared playback", exact: true })
    .getByRole("slider", { name: "Time of day" });
  await seek.focus();
  await seek.press("End");
  const panel = page.getByRole("region", { name: "Inspect customers" });
  const select = panel.getByLabel("Inspect a customer");
  await select.selectOption(done.customerId);
  const activity = panel.getByRole("status", { name: "Customer activity" });
  const whole = Math.floor(done.timeMin);
  const departure = `${String(Math.floor(whole / 60) % 24).padStart(2, "0")}:${String(whole % 60).padStart(2, "0")}`;
  await expect(activity).toContainText(`Served, left at ${departure}`);
  await expect(select.locator("option:checked")).toHaveText(/^Customer \d+$/);
  const first = await activity.textContent();
  await seek.focus();
  await seek.press("ArrowLeft");
  await expect(activity).toHaveText(first!);
  await expect(select).toHaveValue(done.customerId);
});
