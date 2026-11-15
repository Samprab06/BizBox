import { expect, expectNoA11yViolations, test } from "./fixtures";

test("an unmatched URL keeps HTTP 404 and offers a branded way home", async ({
  page,
}) => {
  const response = await page.goto("/does-not-exist");
  expect(response?.status()).toBe(404);
  await expect(
    page.getByRole("heading", { level: 1, name: "Page not found" }),
  ).toBeVisible();
  await expect(
    page.getByRole("banner").getByRole("link", { name: "BizBox" }),
  ).toHaveAttribute("href", "/");
  await expect(
    page.getByRole("link", { name: "Go home", exact: true }),
  ).toHaveAttribute("href", "/");
  await expectNoA11yViolations(page);
});

test("an unknown site keeps HTTP 404 and recovers to its project map even after assistant focus", async ({
  page,
}) => {
  await page.goto("/api/health");
  await page.evaluate(() =>
    sessionStorage.setItem(
      "bizbox:consultant-layout:v1:houston-coffee",
      "focus",
    ),
  );
  const response = await page.goto("/projects/houston-coffee/sites/bogus");
  expect(response?.status()).toBe(404);
  await expect(
    page.getByRole("heading", { level: 1, name: "Page not found" }),
  ).toBeVisible();
  const back = page.getByRole("link", {
    name: "Back to project map",
    exact: true,
  });
  await expect(back).toHaveAttribute("href", "/projects/houston-coffee/map");
  await expect(back).toBeVisible();
  await back.focus();
  await expect(back).toBeFocused();
  await expect(
    page.getByRole("banner").getByRole("link", { name: "BizBox" }),
  ).toHaveCount(1);
  await expect(
    page.getByRole("complementary", { name: "Assistant", exact: true }),
  ).toHaveCount(0);
  await expect(
    page.getByRole("link", { name: "Go home", exact: true }),
  ).toHaveAttribute("href", "/");
  await expectNoA11yViolations(page);
});
