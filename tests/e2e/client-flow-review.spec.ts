import { expect, expectNoA11yViolations, test } from "./fixtures";

test.use({ viewport: { width: 1366, height: 900 } });
test("review carries one property, experiments and chat across all stages without service calls", async ({
  page,
}) => {
  const serviceRequests: string[] = [];
  page.on("request", (request) => {
    if (new URL(request.url()).pathname.startsWith("/api/"))
      serviceRequests.push(request.url());
  });
  await page.goto("/review/client-flow");
  await expect(page).toHaveTitle("BizBox · Client flow review");
  await expect(
    page.getByText("Sample data · Review only", { exact: true }),
  ).toBeVisible();
  const property = page.getByRole("region", { name: "Selected location" });
  await expect(property).toContainText("100 Sample Avenue");
  await expect(
    property
      .getByRole("region", { name: "Spaces at this location" })
      .getByRole("button"),
  ).toHaveCount(2);
  const draft = page.getByRole("textbox", { name: "Review message" });
  await draft.fill("Keep this draft across the flow");
  await page.getByRole("tab", { name: "Voice", exact: true }).click();
  await expect(
    page.getByText("Voice unavailable in review", { exact: true }),
  ).toBeVisible();
  await expect(
    page.getByRole("button", { name: "Start voice", exact: true }),
  ).toBeDisabled();
  await page.getByRole("tab", { name: "Text", exact: true }).click();
  await expect(draft).toHaveValue("Keep this draft across the flow");
  await property
    .getByRole("button", { name: "Compare locations", exact: true })
    .click();
  const compare = page.getByRole("region", {
    name: "Review location comparison",
  });
  await expect(compare).toContainText("-$1,200");
  await compare
    .getByRole("button", { name: "200 Sample Avenue", exact: true })
    .click();
  await expect(property).toContainText("200 Sample Avenue");
  const stages = page.getByRole("navigation", { name: "Review stages" });
  await stages.getByRole("button", { name: "Outdoor", exact: true }).click();
  const staff = page.getByRole("slider", {
    name: "Staff on shift",
    exact: true,
  });
  await staff.focus();
  await page.keyboard.press("ArrowRight");
  await expect(staff).toHaveValue("3");
  await page.getByRole("button", { name: "Run sample", exact: true }).click();
  await expect(
    page.getByRole("table", { name: "Illustrative before and after metrics" }),
  ).toContainText("2600");
  await staff.focus();
  await page.keyboard.press("ArrowRight");
  await expect(
    page.getByRole("button", { name: "Keep change", exact: true }),
  ).toHaveCount(0);
  await page.getByRole("button", { name: "Run sample", exact: true }).click();
  await page.getByRole("button", { name: "Keep change", exact: true }).click();
  await expect(
    page.getByText("Change kept in this tab only.", { exact: true }),
  ).toBeVisible();
  await expect(
    page.getByRole("table", { name: "Illustrative before and after metrics" }),
  ).toContainText("2600");
  await stages.getByRole("button", { name: "Interior", exact: true }).click();
  await expect(
    page.getByText("No verified scan in this review", { exact: true }),
  ).toBeVisible();
  await expect(page.locator("iframe")).toHaveCount(0);
  await page
    .getByRole("button", { name: "Illustrative floor plan", exact: true })
    .click();
  await expect(
    page.getByRole("img", { name: "2 illustrative service stations" }),
  ).toBeVisible();
  await page
    .getByRole("button", { name: "Test indoor capacity", exact: true })
    .click();
  const stations = page.getByRole("slider", {
    name: "Service stations",
    exact: true,
  });
  await stations.focus();
  await page.keyboard.press("ArrowRight");
  await page.getByRole("button", { name: "Run sample", exact: true }).click();
  await expect(
    page.getByRole("img", { name: "3 illustrative service stations" }),
  ).toBeVisible();
  await expect(
    page.getByRole("table", { name: "Illustrative before and after metrics" }),
  ).toContainText("112");
  await page
    .getByRole("button", { name: "Discard change", exact: true })
    .click();
  await expect(stations).toHaveValue("2");
  await stages.getByRole("button", { name: "Cash", exact: true }).click();
  await expect(page.getByRole("region", { name: "Cash review" })).toContainText(
    "Nessie simulated banking",
  );
  await page
    .getByRole("combobox", { name: "Demo account" })
    .selectOption("review-reserve");
  await page
    .getByRole("textbox", { name: "Upfront buildout / $" })
    .fill("20000");
  await stages.getByRole("button", { name: "Property", exact: true }).click();
  await stages.getByRole("button", { name: "Cash", exact: true }).click();
  await expect(
    page.getByRole("combobox", { name: "Demo account" }),
  ).toHaveValue("review-reserve");
  await expect(
    page.getByRole("textbox", { name: "Upfront buildout / $" }),
  ).toHaveValue("20000");
  await page
    .getByRole("combobox", { name: "Connection state" })
    .selectOption("unconfigured");
  await expect(
    page.getByText("Nessie not configured", { exact: true }),
  ).toBeVisible();
  await page
    .getByRole("button", { name: "Return to sample accounts", exact: true })
    .click();
  await page
    .getByRole("combobox", { name: "Preview state" })
    .selectOption("error");
  await expect(
    page.getByRole("alert").filter({ hasText: "Sample error state" }),
  ).toBeVisible();
  await page.getByRole("button", { name: "Retry sample", exact: true }).click();
  await expect(draft).toHaveValue("Keep this draft across the flow");
  await page.getByRole("button", { name: "Send", exact: true }).click();
  await expect(
    page.getByRole("log", { name: "Review conversation" }),
  ).toContainText("200 Sample Avenue · Cash");
  await expect(
    page.getByRole("log", { name: "Review conversation" }),
  ).toContainText("Scripted reply");
  expect(serviceRequests).toEqual([]);
  await page.screenshot({ path: "/tmp/bizbox-client-flow-cash.png" });
  await expectNoA11yViolations(page);
  await page.setViewportSize({ width: 500, height: 852 });
  await stages.getByRole("button", { name: "Indoor", exact: true }).click();
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBe(true);
  await expect(
    page.getByRole("heading", { name: "Indoor experiment", exact: true }),
  ).toBeVisible();
  await page.screenshot({ path: "/tmp/bizbox-client-flow-compact.png" });
});
