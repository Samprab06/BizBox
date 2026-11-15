import { test, expect, expectNoA11yViolations } from "./fixtures";

test("production role colors, neutral controls and print retain the shared foundation", async ({
  page,
}) => {
  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.route("**/api/projects/**", (route) =>
    route.fulfill({
      status: 503,
      json: { error: "Unavailable in style test" },
    }),
  );
  await page.route("**/api/vexcel/**", (route) => route.abort());
  await page.route("https://my.matterport.com/**", (route) => route.abort());
  await page.goto("/projects/houston-coffee/simulator");
  const legend = page.getByLabel("Dot legend", { exact: true });
  const customer = legend.locator(".bg-agent-customer");
  const employee = legend.locator(".bg-agent-employee");
  await expect(customer).toHaveCSS("background-color", "rgb(96, 165, 250)");
  await expect(employee).toHaveCSS("background-color", "rgb(192, 132, 252)");
  expect(
    await page.evaluate(() =>
      getComputedStyle(document.documentElement)
        .getPropertyValue("--color-agent-employee")
        .trim(),
    ),
  ).not.toBe("");
  await legend.scrollIntoViewIfNeeded();
  await expectNoA11yViolations(page);
  await page.screenshot({ path: "/tmp/hac147-simulator-style.png" });
  await page.emulateMedia({ media: "print" });
  await expect(customer).toHaveCSS("background-color", "rgb(23, 24, 29)");
  await expect(employee).toHaveCSS("background-color", "rgb(23, 24, 29)");
});

test("selected insight choices retain their paired white control and dark text", async ({
  page,
}) => {
  await page.goto("/projects/houston-coffee/sites/montrose");
  const days = page.getByRole("group", { name: "Insights day", exact: true });
  const basis = page.getByRole("group", {
    name: "Revenue time basis",
    exact: true,
  });
  for (const [group, label] of [
    [days, "Weekday"],
    [days, "Weekend"],
    [basis, "Hourly revenue"],
    [basis, "Cumulative revenue"],
  ] as const) {
    const choice = group.getByRole("button", { name: label, exact: true });
    await choice.click();
    await expect(choice).toHaveAttribute("aria-pressed", "true");
    await expect(choice).toHaveAttribute("data-variant", "primary");
    await expect(choice).toHaveCSS("color", "rgb(23, 24, 29)");
  }
  await expectNoA11yViolations(page);
});
