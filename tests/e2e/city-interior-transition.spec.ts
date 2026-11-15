import { expect, test } from "./fixtures";

test.beforeEach(async ({ page }) => {
  await page.route("**/api/vexcel/**", (route) => route.abort());
  await page.route("**/matterport/**", (route) => route.abort());
  // No interior record for the example site: the labelled modeled fallback opens.
  await page.route("**/api/sites/*/interior", (route) =>
    route.fulfill({
      status: 404,
      contentType: "application/json",
      body: JSON.stringify({ error: "not_found" }),
    }),
  );
});

test("HAC-99: street ↔ interior keeps the clock, selection and focus both ways", async ({
  page,
}) => {
  await page.goto("/projects/houston-coffee/simulator");
  const handoff = page.getByRole("region", { name: "Street and interior" });
  const view = handoff.getByRole("status", { name: "Current view" });
  const shared = page
    .getByRole("group", { name: "Shared playback", exact: true })
    .getByRole("slider", { name: "Time of day" });
  const picker = page
    .getByRole("region", { name: "Inspect customers" })
    .getByLabel("Inspect a customer");

  await expect(view).toContainText("Street view");
  await expect(shared).toBeVisible();
  expect((await shared.boundingBox())!.width).toBeGreaterThanOrEqual(44);
  await shared.fill("600");
  await expect(shared).toHaveValue("600");
  await picker.selectOption("customer-1");

  // Into the space.
  const enter = handoff.getByRole("button", { name: "Enter the space" });
  await enter.click();
  await expect(view).toContainText("Interior view");
  const back = handoff.getByRole("button", { name: "Back to street" });
  await expect(back).toBeFocused();
  const interior = handoff.getByRole("region", { name: "Interior view" });
  await expect(interior).toBeVisible();
  await expect(interior.locator("[data-interior-label]")).toContainText(
    "Modeled layout",
  );
  await expect(
    interior.getByRole("list", { name: "Interior source notes" }),
  ).toContainText("No interior record exists for this space.");
  await expect(
    handoff
      .getByRole("group", { name: "Interior timeline" })
      .getByRole("slider", { name: "Time of day" }),
  ).toHaveValue("600");
  await expect(shared).toHaveValue("600");
  await expect(
    interior.getByRole("status", { name: "Interior inspection" }),
  ).toContainText("customer-1");
  // The street renderer is unmounted while the interior draws.
  await expect(
    handoff.getByText("3D neighborhood unavailable", { exact: false }),
  ).toHaveCount(0);

  // Back to the street.
  await back.click();
  await expect(view).toContainText("Street view");
  await expect(
    handoff.getByRole("button", { name: "Enter the space" }),
  ).toBeFocused();
  await expect(interior).toHaveCount(0);
  await expect(shared).toHaveValue("600");
  await expect(picker).toHaveValue("customer-1");
});
