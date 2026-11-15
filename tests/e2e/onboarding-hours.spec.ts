import type { Locator, Page } from "@playwright/test";
import { workspaceHref } from "../../lib/client/workspace-routes";
import { expect, expectNoA11yViolations, test } from "./fixtures";

// HAC-154: the business-hours question is a 24-hour glass clock dial. Midnight is at the
// top and time runs clockwise. Answers are stored in the existing intake session's `hours`
// field as 24-hour text that profileFromIntake reads.

const storageKey = "sitework:intake:v1:houston-coffee";
const ARC_RATIO = 100 / 320; // handle track radius / dial size, from clock-dial.tsx
const title = (page: Page) => page.locator("#onboarding-title");
const proceed = (page: Page) => page.getByRole("button", { name: "Continue", exact: true });
const opens = (page: Page) => page.getByRole("slider", { name: "Opening time" });
const closes = (page: Page) => page.getByRole("slider", { name: "Closing time" });
const readout = (page: Page) => page.getByTestId("clock-readout");

const founder = (value: string) => ({ value, origin: "founder" });
const everythingButHours = {
  category: founder("Coffee shop"),
  concept: founder("Neighborhood coffee bar"),
  customers: founder("Remote workers"),
  city: founder("Houston"),
  areas: founder("No preference"),
  rent: founder("4500"),
  buildout: founder("80000"),
  price: founder("Midrange"),
  staff: founder("2"),
  requirements: founder("None"),
};

async function saved(page: Page) {
  const raw = await page.evaluate((key) => localStorage.getItem(key), storageKey);
  return raw ? (JSON.parse(raw) as { profile: Record<string, { value: string; origin: string } | undefined> }) : null;
}

async function openHoursQuestion(page: Page) {
  await page.evaluate(
    ([key, profile]) => localStorage.setItem(key as string, JSON.stringify({ profile, messages: [] })),
    [storageKey, everythingButHours] as const,
  );
  await page.goto(workspaceHref("houston-coffee", "intake"));
  await expect(title(page)).toHaveText("When will you be open?");
  // Pointer coordinates must be inside the viewport.
  await page.getByTestId("clock-dial").evaluate((el) => el.scrollIntoView({ block: "center" }));
}

/** The screen point on the handle track at a time of day. */
async function dialPoint(page: Page, minute: number) {
  const box = (await page.getByTestId("clock-dial").boundingBox())!;
  const radians = (minute / 1440) * 2 * Math.PI;
  const r = box.width * ARC_RATIO;
  return { x: box.x + box.width / 2 + Math.sin(radians) * r, y: box.y + box.height / 2 - Math.cos(radians) * r };
}

async function center(locator: Locator) {
  const box = (await locator.boundingBox())!;
  return { x: box.x + box.width / 2, y: box.y + box.height / 2 };
}

async function mouseDrag(page: Page, handle: Locator, minutes: number[]) {
  const start = await center(handle);
  await page.mouse.move(start.x, start.y);
  await page.mouse.down();
  for (const minute of minutes) {
    const point = await dialPoint(page, minute);
    await page.mouse.move(point.x, point.y, { steps: 4 });
  }
  await page.mouse.up();
}

/** A touch drag, sent as touch pointer events (the dial only listens to pointer events). */
async function touchDrag(page: Page, handle: Locator, minute: number) {
  const start = await center(handle);
  const end = await dialPoint(page, minute);
  const init = { pointerId: 7, pointerType: "touch", isPrimary: true, bubbles: true, button: 0 };
  await handle.dispatchEvent("pointerdown", { ...init, clientX: start.x, clientY: start.y });
  for (let i = 1; i <= 4; i++) {
    const t = i / 4;
    await handle.dispatchEvent("pointermove", { ...init, clientX: start.x + (end.x - start.x) * t, clientY: start.y + (end.y - start.y) * t });
  }
  await handle.dispatchEvent("pointerup", { ...init, clientX: end.x, clientY: end.y });
}

test.beforeEach(async ({ page, clearIntakeStorage }) => {
  await page.route("**/api/projects/*/intake", (route) =>
    route.request().method() === "GET" ? route.fulfill({ json: { modelConfigured: false } }) : route.fallback(),
  );
  await clearIntakeStorage();
});

test("defaults to 9:00 AM – 5:00 PM, which is saved as founder input only after Continue", async ({ page }) => {
  await openHoursQuestion(page);
  await expect(opens(page)).toHaveAttribute("aria-valuetext", "Opens at 9:00 AM");
  await expect(closes(page)).toHaveAttribute("aria-valuetext", "Closes at 5:00 PM");
  await expect(readout(page)).toContainText("9:00 AM –5:00 PM");
  await expect(readout(page)).toContainText("8 hrs");
  // Every 3 hours is labelled.
  for (const label of ["12a", "3a", "6a", "9a", "12p", "3p", "6p", "9p"])
    await expect(page.getByTestId("clock-dial").getByText(label, { exact: true })).toBeAttached();
  await expect(page.getByRole("button", { name: "9–5" })).toHaveAttribute("aria-pressed", "true");

  // Not saved before Continue, even across a reload.
  expect((await saved(page))?.profile.hours).toBeUndefined();
  await page.reload();
  await expect(title(page)).toHaveText("When will you be open?");
  expect((await saved(page))?.profile.hours).toBeUndefined();

  await proceed(page).click();
  await expect(title(page)).toHaveText("How many people will be on shift?");
  expect((await saved(page))?.profile.hours).toEqual({ value: "09:00–17:00", origin: "founder" });
  await expectNoA11yViolations(page);
});

test("keyboard moves each handle by 15 minutes, an hour with Shift, and to the limits with Home and End", async ({ page }) => {
  await openHoursQuestion(page);
  await opens(page).focus();
  await page.keyboard.press("ArrowRight");
  await expect(opens(page)).toHaveAttribute("aria-valuetext", "Opens at 9:15 AM");
  await page.keyboard.press("Shift+ArrowRight");
  await expect(opens(page)).toHaveAttribute("aria-valuetext", "Opens at 10:15 AM");
  await page.keyboard.press("ArrowDown");
  await expect(opens(page)).toHaveAttribute("aria-valuetext", "Opens at 10:00 AM");
  await page.keyboard.press("Home");
  await expect(opens(page)).toHaveAttribute("aria-valuetext", "Opens at 12:00 AM");
  // End stops 30 minutes before closing: the handles never cross.
  await page.keyboard.press("End");
  await expect(opens(page)).toHaveAttribute("aria-valuetext", "Opens at 4:30 PM");
  await expect(readout(page)).toContainText("30 min");

  await page.keyboard.press("Tab");
  await expect(closes(page)).toBeFocused();
  await page.keyboard.press("End");
  await expect(closes(page)).toHaveAttribute("aria-valuetext", "Closes at 12:00 AM");
  await page.keyboard.press("Shift+ArrowLeft");
  await expect(closes(page)).toHaveAttribute("aria-valuetext", "Closes at 11:00 PM");
  await page.keyboard.press("Home");
  await expect(closes(page)).toHaveAttribute("aria-valuetext", "Closes at 5:00 PM");
});

test("handles drag with a mouse and by touch, snap to 15 minutes and can't cross", async ({ page }) => {
  await openHoursQuestion(page);
  // Mouse: closing time to 6 PM (the left of the dial).
  await mouseDrag(page, closes(page), [1050, 1083]);
  await expect(closes(page)).toHaveAttribute("aria-valuetext", "Closes at 6:00 PM");
  // Mouse: opening time 7:07 snaps to 7:00.
  await mouseDrag(page, opens(page), [480, 427]);
  await expect(opens(page)).toHaveAttribute("aria-valuetext", "Opens at 7:00 AM");
  // Dragging the opening time past the closing time stops 30 minutes short.
  await mouseDrag(page, opens(page), [720, 960, 1200]);
  await expect(opens(page)).toHaveAttribute("aria-valuetext", "Opens at 5:30 PM");
  await expect(closes(page)).toHaveAttribute("aria-valuetext", "Closes at 6:00 PM");

  // Touch: opening time back to 8:00 AM, closing time to 9:15 PM.
  await touchDrag(page, opens(page), 480);
  await expect(opens(page)).toHaveAttribute("aria-valuetext", "Opens at 8:00 AM");
  await touchDrag(page, closes(page), 1278);
  await expect(closes(page)).toHaveAttribute("aria-valuetext", "Closes at 9:15 PM");
  await expect(readout(page)).toContainText("13 hrs 15 min");

  // Dragging the arc moves both times together.
  const arcStart = await dialPoint(page, 840);
  const arcEnd = await dialPoint(page, 900);
  await page.mouse.move(arcStart.x, arcStart.y);
  await page.mouse.down();
  await page.mouse.move(arcEnd.x, arcEnd.y, { steps: 4 });
  await page.mouse.up();
  await expect(opens(page)).toHaveAttribute("aria-valuetext", "Opens at 9:00 AM");
  await expect(closes(page)).toHaveAttribute("aria-valuetext", "Closes at 10:15 PM");

  // The dragged value persists after Continue and a reload.
  await proceed(page).click();
  expect((await saved(page))?.profile.hours).toEqual({ value: "09:00–22:15", origin: "founder" });
  await page.reload();
  await expect(title(page)).toHaveText("Review your business");
  await expect(page.getByText("9:00 AM – 10:15 PM")).toBeVisible();
  await page.getByRole("button", { name: "Edit hours" }).click();
  await expect(title(page)).toHaveText("When will you be open?");
  await expect(opens(page)).toHaveAttribute("aria-valuetext", "Opens at 9:00 AM");
  await expect(closes(page)).toHaveAttribute("aria-valuetext", "Closes at 10:15 PM");
});

test("the centre readout takes exact typed times", async ({ page }) => {
  await openHoursQuestion(page);
  await readout(page).click();
  const open = page.getByRole("textbox", { name: "Opens" });
  const close = page.getByRole("textbox", { name: "Closes" });
  await expect(open).toHaveValue("9:00 AM");
  await open.fill("7:10 am");
  await close.fill("25:00");
  await close.press("Enter");
  await expect(page.getByRole("alert").filter({ hasText: "Use a time like 9:30 AM or 17:30." })).toBeVisible();
  // Enter in the editor does not submit the question.
  await expect(title(page)).toHaveText("When will you be open?");
  await close.fill("21:00");
  await close.press("Enter");
  await expect(opens(page)).toHaveAttribute("aria-valuetext", "Opens at 7:10 AM");
  await expect(closes(page)).toHaveAttribute("aria-valuetext", "Closes at 9:00 PM");
  await proceed(page).click();
  expect((await saved(page))?.profile.hours).toEqual({ value: "07:10–21:00", origin: "founder" });
});

test("handles do not scale or animate their glow under reduced motion", async ({ page }) => {
  await page.emulateMedia({ reducedMotion: "reduce" });
  await openHoursQuestion(page);
  const handle = opens(page);
  expect(await handle.evaluate((el) => getComputedStyle(el).transitionDuration)).toBe("0s");
  const start = await center(handle);
  await page.mouse.move(start.x, start.y);
  await page.mouse.down();
  await expect(handle).toHaveAttribute("data-dragging", "true");
  expect(await handle.evaluate((el) => getComputedStyle(el).scale)).toBe("none");
  await page.mouse.up();
});

for (const viewport of [
  { width: 1366, height: 768 },
  { width: 390, height: 844 },
]) {
  test(`hour labels don't overlap at ${viewport.width}x${viewport.height}`, async ({ page }) => {
    await page.setViewportSize(viewport);
    await openHoursQuestion(page);
    const boxes = await page
      .getByTestId("clock-dial")
      .locator("text")
      .evaluateAll((nodes) => nodes.map((node) => node.getBoundingClientRect().toJSON() as DOMRect));
    expect(boxes).toHaveLength(8);
    for (let i = 0; i < boxes.length; i++)
      for (let j = i + 1; j < boxes.length; j++) {
        const a = boxes[i]!, b = boxes[j]!;
        const overlap = a.left < b.right && b.left < a.right && a.top < b.bottom && b.top < a.bottom;
        expect(overlap).toBe(false);
      }
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
    expect(overflow).toBeLessThanOrEqual(0);
  });
}
