import type { Page } from "@playwright/test";
import { workspaceHref } from "../../lib/client/workspace-routes";
import { expect, expectNoA11yViolations, test } from "./fixtures";

// HAC-127: the guided BizBox onboarding is the intake view's default. Copy comes from
// components/onboarding/flow.ts; answers are stored in the existing intake session.

const storageKey = "sitework:intake:v1:houston-coffee";
const title = (page: Page) => page.locator("#onboarding-title");
const proceed = (page: Page) => page.getByRole("button", { name: "Continue", exact: true });
const exact = (page: Page) => page.getByRole("textbox", { name: /exact amount/ });
const ruler = (page: Page) => page.getByRole("slider");
const card = (page: Page) => page.getByRole("region", { name: "Review your business" });

async function saved(page: Page) {
  const raw = await page.evaluate((key) => localStorage.getItem(key), storageKey);
  return raw ? (JSON.parse(raw) as { profile: Record<string, { value: string; origin: string }> }) : null;
}

async function expectNoOverflow(page: Page) {
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
  expect(overflow).toBeLessThanOrEqual(0);
}

test.beforeEach(async ({ page, clearIntakeStorage }) => {
  // Offline intake, as in intake.spec.ts; the live path is covered by unit tests of patchFromForm.
  await page.route("**/api/projects/*/intake", (route) =>
    route.request().method() === "GET" ? route.fulfill({ json: { modelConfigured: false } }) : route.fallback(),
  );
  await clearIntakeStorage();
});

test("with a live intake model, each confirmed answer is sent as a founder patch", async ({ page }) => {
  const posts: { patch?: Record<string, unknown>; message?: string }[] = [];
  await page.route("**/api/projects/*/intake", async (route) => {
    if (route.request().method() === "GET") return route.fulfill({ json: { modelConfigured: true } });
    posts.push(route.request().postDataJSON() as (typeof posts)[number]);
    await route.fulfill({ status: 503, json: { message: "Intake is temporarily unavailable." } });
  });
  await page.goto(workspaceHref("houston-coffee", "intake"));
  // Let the screen learn the model is configured before answering.
  await page.waitForLoadState("networkidle");
  await page.getByRole("button", { name: "Quick food" }).click();
  await proceed(page).click();
  await expect.poll(() => posts.length).toBe(1);
  expect(posts[0]).toMatchObject({ patch: { category: "quick_food" } });
  expect(posts[0]!.message).toBeUndefined();
  // A failed sync is reported in the card and the answer stays saved and pending.
  await expect(page.getByRole("alert").filter({ hasText: "Your profile edits still work." })).toBeVisible();
  const session = (await saved(page)) as { profile: Record<string, unknown>; pending?: string[] } | null;
  expect(session?.profile.category).toEqual({ value: "Quick-service food", origin: "founder" });
  expect(session?.pending).toEqual(["category"]);
});

for (const viewport of [
  { width: 1366, height: 768 },
  { width: 390, height: 844 },
]) {
  test.describe(`at ${viewport.width}x${viewport.height}`, () => {
    test.use({ viewport });

    test("the guided flow completes a profile the map accepts, and survives a reload", async ({ page }) => {
      await page.goto(workspaceHref("houston-coffee", "intake"));
      await expect(page.getByRole("heading", { level: 1, name: "Intake" })).toBeVisible();

      // Category: Other is a disabled Coming soon option.
      await expect(title(page)).toHaveText("What are you opening?");
      await expect(page.getByRole("button", { name: "Other Coming soon" })).toBeDisabled();
      await expectNoOverflow(page);
      await page.getByRole("button", { name: "Quick food" }).click();
      await expect(page.getByRole("button", { name: "Quick food" })).toHaveAttribute("aria-pressed", "true");
      await proceed(page).click();

      // Concept: empty answers are rejected; no sample text is filled in.
      await expect(title(page)).toHaveText("Describe your business.");
      await expect(page.getByRole("textbox", { name: "Describe your business." })).toHaveValue("");
      await proceed(page).click();
      await expect(page.getByRole("alert").filter({ hasText: "Add your answer to continue." })).toBeVisible();
      await page.getByRole("textbox", { name: "Describe your business." }).fill("Late-night dumpling counter");
      await proceed(page).click();

      // Back keeps answers.
      await expect(title(page)).toHaveText("Who is it for?");
      await page.getByRole("button", { name: "Back", exact: true }).click();
      await expect(page.getByRole("textbox", { name: "Describe your business." })).toHaveValue("Late-night dumpling counter");
      await proceed(page).click();
      await page.getByRole("textbox", { name: "Who is it for?" }).fill("Students and night-shift workers");
      await proceed(page).click();

      // City: real photos with credits; preview cities are disabled.
      await expect(title(page)).toHaveText("Where are you looking?");
      await expect(page.getByRole("button", { name: "New York Coming soon" })).toBeDisabled();
      await page.getByRole("button", { name: /Los Angeles/ }).click();
      await expect(page.getByRole("link", { name: "Rlumstead / Rachel L. Umstead" })).toBeVisible();
      await expect(page.getByRole("link", { name: "CC BY-SA 4.0" })).toBeVisible();
      await expectNoOverflow(page);
      await proceed(page).click();

      // Areas keep favor/avoid meaning.
      await expect(title(page)).toHaveText("Which areas should we favor or avoid?");
      await page.getByRole("button", { name: "Favor Silver Lake" }).click();
      await page.getByRole("button", { name: "Avoid Culver City" }).click();
      await proceed(page).click();

      // Rent: keyboard on the ruler, then an exact typed amount that is not on a detent.
      await expect(title(page)).toHaveText("What’s your monthly rent limit?");
      await expect(exact(page)).toHaveValue("4500");
      await ruler(page).focus();
      await page.keyboard.press("ArrowRight");
      await expect(exact(page)).toHaveValue("4600");
      await page.keyboard.press("PageDown");
      await expect(exact(page)).toHaveValue("3600");
      await exact(page).fill("4550");
      await expect(ruler(page)).toHaveAttribute("aria-valuetext", "$4,550");
      await expectNoOverflow(page);
      await proceed(page).click();

      // Buildout: drag the ruler 10 detents.
      await expect(title(page)).toHaveText("What’s your buildout budget?");
      const box = (await ruler(page).boundingBox())!;
      await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
      await page.mouse.down();
      await page.mouse.move(box.x + box.width / 2 - 70, box.y + box.height / 2, { steps: 5 });
      await page.mouse.move(box.x + box.width / 2 - 140, box.y + box.height / 2, { steps: 5 });
      await page.mouse.up();
      await expect(exact(page)).toHaveValue("130000");
      await proceed(page).click();

      await expect(title(page)).toHaveText("Where will your prices sit?");
      await page.getByRole("button", { name: "Mid-range" }).click();
      await proceed(page).click();

      // Hours must be one same-day range the map can read; Enter submits.
      await expect(title(page)).toHaveText("When will you be open?");
      const hours = page.getByRole("textbox", { name: "When will you be open?" });
      await hours.fill("evenings");
      await hours.press("Enter");
      await expect(page.getByRole("alert").filter({ hasText: /same-day range/ })).toBeVisible();
      await hours.fill("11am – 11pm");
      await hours.press("Enter");

      await expect(title(page)).toHaveText("How many people will be on shift?");
      await ruler(page).focus();
      await page.keyboard.press("ArrowUp");
      await expect(exact(page)).toHaveValue("3");
      await proceed(page).click();

      await expect(title(page)).toHaveText("Anything the space must have?");
      await page.getByRole("button", { name: "Skip" }).click();

      // Review shows the answers; editing one returns here.
      await expect(title(page)).toHaveText("Review your business");
      await expect(card(page).getByText("Quick food", { exact: true })).toBeVisible();
      await expect(card(page).getByText("$4,550")).toBeVisible();
      await page.getByRole("button", { name: "Edit staff" }).click();
      await expect(title(page)).toHaveText("How many people will be on shift?");
      await proceed(page).click();
      await expect(title(page)).toHaveText("Review your business");
      await expect(page.getByRole("link", { name: "Open workspace" })).toHaveAttribute("href", /\/projects\/houston-coffee\/workspace/);
      await expectNoOverflow(page);

      // Stored in the existing intake session, mapped to the intake values, all founder input.
      const session = await saved(page);
      expect(session?.profile).toEqual({
        category: { value: "Quick-service food", origin: "founder" },
        concept: { value: "Late-night dumpling counter", origin: "founder" },
        customers: { value: "Students and night-shift workers", origin: "founder" },
        city: { value: "Los Angeles", origin: "founder" },
        areas: { value: "Favor Silver Lake; Avoid Culver City", origin: "founder" },
        rent: { value: "4550", origin: "founder" },
        buildout: { value: "130000", origin: "founder" },
        price: { value: "Midrange", origin: "founder" },
        hours: { value: "11am – 11pm", origin: "founder" },
        staff: { value: "3", origin: "founder" },
        requirements: { value: "None", origin: "founder" },
      });

      // A reload resumes at the review with every answer.
      await page.reload();
      await expect(title(page)).toHaveText("Review your business");
      await expect(card(page).getByText("Late-night dumpling counter")).toBeVisible();
      // The project context bar reads the same saved session.
      await expect(page.getByRole("link", { name: "Change business concept: Late-night dumpling counter", includeHidden: true }).first()).toBeAttached();

      // The detailed form shows the same profile.
      await page.getByRole("link", { name: "Edit all fields" }).click();
      await expect(page).toHaveURL(/\/intake\?mode=form$/);
      await expect(page.getByLabel("Service category")).toHaveValue("Quick-service food");
      await expect(page.getByLabel("Monthly rent ceiling ($)")).toHaveValue("4550");
      await expect(page.getByText("All required fields are filled.")).toBeVisible();
      await page.getByRole("link", { name: "Back to guided setup" }).click();
      await expect(title(page)).toHaveText("Review your business");
    });

    test("a partly answered flow resumes at the next question after a reload", async ({ page }) => {
      await page.goto(workspaceHref("houston-coffee", "intake"));
      await page.getByRole("button", { name: "Salon", exact: true }).click();
      await proceed(page).click();
      await page.getByRole("textbox", { name: "Describe your business." }).fill("Neighborhood barbershop");
      await proceed(page).click();
      await expect(title(page)).toHaveText("Who is it for?");
      // An unsent draft is not saved as founder input.
      await page.getByRole("textbox", { name: "Who is it for?" }).fill("Draft only");

      await page.reload();
      await expect(title(page)).toHaveText("Who is it for?");
      await expect(page.getByRole("textbox", { name: "Who is it for?" })).toHaveValue("");
      const session = await saved(page);
      expect(session?.profile.category).toEqual({ value: "Salon or barber", origin: "founder" });
      expect(session?.profile.customers).toBeUndefined();
      // City is still only the app default, so it is asked, not assumed.
      expect(session?.profile.city).toEqual({ value: "Houston", origin: "default" });
    });

    test("questions can be answered with the keyboard and focus moves to each new question", async ({ page }) => {
      await page.goto(workspaceHref("houston-coffee", "intake"));
      await expect(title(page)).toHaveText("What are you opening?");
      const fitness = page.getByRole("button", { name: "Fitness", exact: true });
      await fitness.focus();
      await page.keyboard.press("Enter");
      await expect(fitness).toHaveAttribute("aria-pressed", "true");
      await proceed(page).focus();
      await page.keyboard.press("Enter");
      await expect(title(page)).toHaveText("Describe your business.");
      await expect(title(page)).toBeFocused();
      await page.keyboard.press("Tab");
      await expect(page.getByRole("textbox", { name: "Describe your business." })).toBeFocused();
      await page.keyboard.type("Small-group strength studio");
      await proceed(page).focus();
      await page.keyboard.press("Enter");
      await expect(title(page)).toHaveText("Who is it for?");
      await expect(title(page)).toBeFocused();
      await expectNoA11yViolations(page);
    });

    test("the question fade is 120 ms and is removed under reduced motion", async ({ page }) => {
      await page.goto(workspaceHref("houston-coffee", "intake"));
      const content = page.locator("[data-step]");
      await expect(content).toHaveAttribute("data-step", "category");
      expect(await content.evaluate((el) => getComputedStyle(el).animationDuration)).toBe("0.12s");

      await page.emulateMedia({ reducedMotion: "reduce" });
      await proceed(page).click();
      await expect(content).toHaveAttribute("data-step", "concept");
      expect(await content.evaluate((el) => getComputedStyle(el).animationName)).toBe("none");
      await expect(title(page)).toBeFocused();
    });
  });
}
