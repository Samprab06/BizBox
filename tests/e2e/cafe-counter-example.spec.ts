import { test, expect } from "@playwright/test";

// This case uses the existing seeded café workload and actual engine outputs, with no provider.
test.use({ viewport: { width: 1440, height: 1000 } });
test("defined café: exterior assumptions → interior replay → selected report", async ({
  page,
}) => {
  test.setTimeout(60000);
  const failures: string[] = [];
  page.on("pageerror", (error) => failures.push(error.message));
  await page.route("https://**/*", (route) => route.abort());
  await page.goto("/cafe-counter-example");
  await expect(
    page.getByRole("heading", {
      name: "Is a second staffed counter worth it?",
    }),
  ).toBeVisible();
  await expect(
    page.getByRole("button", { name: "Print or save report" }),
  ).toHaveCount(0);
  await expect(
    page.getByRole("button", { name: "Show final café report" }),
  ).toHaveCount(0);
  await expect(
    page.getByText("110 generated customers", { exact: false }),
  ).toBeVisible();
  await page
    .getByRole("button", { name: "Compare one vs two counters" })
    .click();
  await expect(
    page.getByRole("region", { name: "Operating replay", exact: true }),
  ).toBeVisible();
  const timeline = page.getByRole("group", { name: "Shared playback", exact: true }).getByRole("slider", {name:"Time of day"});
  if (await timeline.count()) await timeline.fill("720");
  await page
    .getByRole("combobox", { name: "Report operating plan" })
    .selectOption("1");
  await page.getByRole("button", { name: "Show final café report" }).click();
  const report = page.getByRole("region", { name: "Final café report" });
  await expect(report).toBeVisible();
  await expect(report).toContainText("Chosen plan: two staffed counters");
  await expect(
    report.getByRole("row", { name: "Served by noon 55 80", exact: true }),
  ).toBeVisible();
  await expect(
    report.getByRole("row", {
      name: "Left without service 52 28",
      exact: true,
    }),
  ).toBeVisible();
  await expect(report).toContainText(
    "not an uncertainty estimate or sales forecast",
  );
  await expect(
    report.getByRole("button", { name: "Print or save report" }),
  ).toBeVisible();
  await page.screenshot({
    path: "/tmp/bizbox-cafe-final-report.png",
    fullPage: true,
  });
  await report
    .getByRole("button", { name: "Return to interior comparison" })
    .click();
  await page
    .getByRole("combobox", { name: "Report operating plan" })
    .selectOption("0");
  await page.getByRole("button", { name: "Show final café report" }).click();
  await expect(report).toContainText("Chosen plan: one staffed counter");
  expect(failures).toEqual([]);
});
