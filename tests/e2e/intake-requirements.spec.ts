import { expect, test } from "./fixtures";

const storageKey = "sitework:intake:v1:houston-coffee";
const intake = "/projects/houston-coffee/intake";
const sentence =
  "Street frontage and a dedicated drive-up or street parking for 6 cars";
const answers = {
  category: "Coffee shop",
  concept: "Neighborhood coffee",
  customers: "Commuters",
  city: "Houston",
  areas: "Any",
  rent: "4000",
  buildout: "80000",
  price: "Midrange",
  hours: "07:00–17:00",
  staff: "2",
};

for (const width of [1366, 768, 390]) {
  test.describe(`HAC-168 requirements at ${width}px`, () => {
    test.use({ viewport: { width, height: 900 } });
    test("a live flags-only sync preserves the numbered sentence in review, storage and form", async ({
      page,
      clearIntakeStorage,
    }) => {
      const patches: Record<string, unknown>[] = [];
      await page.route("**/api/projects/*/intake", async (route) => {
        if (route.request().method() === "GET")
          return route.fulfill({ json: { modelConfigured: true } });
        const body = route.request().postDataJSON();
        patches.push(body.patch);
        return route.fulfill({
          json: {
            draft: { ...body.state?.draft, ...body.patch },
            assumptions: {},
            missingRequiredFields: [],
            findings: [],
            nextQuestion: null,
            assistantMessage: "Your requirements are saved.",
          },
        });
      });
      await clearIntakeStorage();
      await page.evaluate(
        ({ key, answers }) => {
          localStorage.setItem(
            key,
            JSON.stringify({
              profile: Object.fromEntries(
                Object.entries(answers).map(([key, value]) => [
                  key,
                  { value, origin: "founder" },
                ]),
              ),
              messages: [],
            }),
          );
        },
        { key: storageKey, answers },
      );
      await page.goto(intake);
      await expect(page.locator("#onboarding-title")).toHaveText(
        "Anything the space must have?",
      );
      // Ensure the availability probe has settled before confirming a live form edit.
      await page.waitForLoadState("networkidle");
      await page
        .getByRole("textbox", { name: "Anything the space must have?" })
        .fill(sentence);
      await page.getByRole("button", { name: "Continue", exact: true }).click();
      await expect.poll(() => patches.length).toBe(1);
      expect(patches[0]).toMatchObject({
        mustHaves: { frontage: { value: true }, parking: { value: true } },
      });
      await expect
        .poll(() =>
          page.evaluate(
            (key) => JSON.parse(localStorage.getItem(key)!).pending,
            storageKey,
          ),
        )
        .toEqual([]);
      const review = page.getByRole("region", { name: "Review your business" });
      await expect(review.getByText(sentence, { exact: true })).toBeVisible();
      expect(
        await page.evaluate(
          (key) => JSON.parse(localStorage.getItem(key)!).profile.requirements,
          storageKey,
        ),
      ).toEqual({ value: sentence, origin: "founder" });
      await page.reload();
      await expect(review.getByText(sentence, { exact: true })).toBeVisible();
      await page.getByRole("link", { name: "Edit all fields" }).click();
      await expect(page).toHaveURL(/\/intake\?mode=form$/);
      await expect(page.getByLabel("Must-haves", { exact: true })).toHaveValue(
        sentence,
      );
    });
  });
}
