import type { Page, Route } from "@playwright/test";
import { liveSearch, liveSiteId } from "./live-site-fixtures";
import { workspaceHref } from "../../lib/client/workspace-routes";
import {
  closeConsultant,
  expect,
  expectNoA11yViolations,
  openConsultant,
  test,
} from "./fixtures";

// HAC-129: guided onboarding and the workspace are one session. Every network boundary is a
// page.route mock: no model, voice, listing or database service is called.

const VIEWPORTS = [
  { width: 1280, height: 800 },
  { width: 768, height: 1024 },
  { width: 390, height: 844 },
] as const;

const storageKey = "sitework:intake:v1:houston-coffee";
const draftKey = "bizbox:assistant-draft:v1:houston-coffee";

const title = (page: Page) => page.locator("#onboarding-title");
const proceed = (page: Page) =>
  page.getByRole("button", { name: "Continue", exact: true });
const assistant = (page: Page) =>
  page.getByRole("complementary", { name: "Assistant" });
const composer = (page: Page) =>
  page.getByRole("textbox", { name: "Message the BizBox assistant" });
const tab = (page: Page, name: "Text" | "Voice") =>
  assistant(page).getByRole("tab", { name });
const log = (page: Page) =>
  assistant(page).getByRole("log", { name: "Conversation" });

/** Opens the phone sheet once the workspace has rendered (navigation closes the sheet). */
async function openWorkspaceConsultant(page: Page) {
  await expect(
    page.getByRole("heading", { level: 1, name: "Workspace" }),
  ).toBeVisible();
  await expect(
    page.getByText("Listings unavailable", { exact: true }),
  ).toBeVisible();
  await expect(
    page.getByRole("button", { name: "Retry", exact: true }),
  ).toBeVisible();
  await expect(
    page.getByRole("group", { name: "Matching locations" }),
  ).toHaveCount(0);
  await expect(
    page.getByText("Montrose storefront", { exact: true }),
  ).toHaveCount(0);
  await openConsultant(page);
}

const reply = (assistantMessage: string) => ({
  persisted: false,
  draft: {},
  assumptions: {},
  profile: null,
  missingRequiredFields: [],
  findings: [],
  questions: [],
  nextQuestion: null,
  defaultSources: [],
  assistantMessage,
});

/**
 * The intake agent starts offline (so onboarding sends nothing) and goes live when the test
 * says so. Each message POST is held until the test answers it.
 */
async function mockServices(page: Page, options: { listings?: boolean } = {}) {
  const state = { live: false };
  const messages: { message?: string; state?: unknown }[] = [];
  const held: Route[] = [];
  await page.route("**/api/projects/*/intake", async (route) => {
    if (route.request().method() === "GET")
      return route.fulfill({ json: { modelConfigured: state.live } });
    const body = route.request().postDataJSON() as (typeof messages)[number];
    if (body.message === undefined) return route.fulfill({ json: reply("ok") });
    messages.push(body);
    held.push(route);
  });
  await page.route("**/api/voice/session", (route) =>
    route.request().method() === "GET"
      ? route.fulfill({ json: { configured: false } })
      : route.fulfill({ status: 503, json: { message: "not used" } }),
  );
  const listingSearch = structuredClone(liveSearch);
  listingSearch.candidates.forEach((entry) => {
    entry.candidate.synthetic = false;
    entry.candidate.city = "Los Angeles";
  });
  await page.route("**/api/sites", (route) =>
    options.listings
      ? route.fulfill({ json: listingSearch })
      : route.fulfill({ status: 503, json: { message: "not used" } }),
  );
  await page.route("**/api/comparisons/capabilities", (route) =>
    route.fulfill({ json: { jevConfigured: false } }),
  );
  return { state, messages, held };
}

async function expectNoOverflow(page: Page) {
  const overflow = await page.evaluate(
    () =>
      document.documentElement.scrollWidth -
      document.documentElement.clientWidth,
  );
  expect(overflow).toBeLessThanOrEqual(0);
}

async function savedSession(page: Page) {
  const raw = await page.evaluate(
    (key) => localStorage.getItem(key),
    storageKey,
  );
  return raw
    ? (JSON.parse(raw) as {
        profile: Record<string, { value: string; origin: string }>;
        messages: { role: string; text: string }[];
      })
    : null;
}

/** Answers every guided question through the real screens and stops on the review. */
async function completeOnboarding(page: Page) {
  await page.goto(workspaceHref("houston-coffee", "intake"));
  await page.getByRole("button", { name: "Quick food" }).click();
  await proceed(page).click();
  await page
    .getByRole("textbox", { name: "Describe your business." })
    .fill("Late-night dumpling counter");
  await proceed(page).click();
  await page
    .getByRole("textbox", { name: "Who is it for?" })
    .fill("Students and night-shift workers");
  await proceed(page).click();
  await page.getByRole("button", { name: /Los Angeles/ }).click();
  await proceed(page).click();
  await page.getByRole("button", { name: "Skip" }).click();
  await page.getByRole("textbox", { name: /exact amount/ }).fill("4550");
  await proceed(page).click();
  await proceed(page).click();
  await page.getByRole("button", { name: "Mid-range" }).click();
  await proceed(page).click();
  // HAC-154: the hours dial starts at 9:00 AM – 5:00 PM; Continue confirms it.
  await expect(
    page.getByRole("slider", { name: "Opening time" }),
  ).toHaveAttribute("aria-valuetext", "Opens at 9:00 AM");
  await proceed(page).click();
  await proceed(page).click();
  await page.getByRole("button", { name: "Skip" }).click();
  await expect(title(page)).toHaveText("Review your business");
}

test.beforeEach(async ({ clearIntakeStorage, page }) => {
  await page.goto(workspaceHref("houston-coffee", "intake"));
  await clearIntakeStorage();
  await page.evaluate(() => sessionStorage.clear());
});

for (const viewport of VIEWPORTS) {
  test.describe(`at ${viewport.width}x${viewport.height}`, () => {
    test.use({ viewport });

    test("onboarding hands the same session to the workspace, and Edit brief returns to it", async ({
      page,
    }) => {
      const { state } = await mockServices(page, { listings: true });
      await completeOnboarding(page);
      await expectNoOverflow(page);

      // The finish opens the workspace with this brief; unavailable inventory does not invent a selected site.
      const open = page.getByRole("link", { name: "Open workspace" });
      await expect(open).toHaveAttribute(
        "href",
        "/projects/houston-coffee/workspace",
      );
      state.live = true;
      const initialSearch = page.waitForRequest(
        (request) =>
          request.url().endsWith("/api/sites") && request.method() === "POST",
      );
      await open.click();
      expect(
        (await initialSearch).postDataJSON().profile.economics
          .monthlyRentCeilingCents.value,
      ).toBe(455000);
      await expect(
        page.getByRole("heading", { level: 1, name: "Workspace" }),
      ).toBeVisible();
      await openConsultant(page);
      await expect(
        assistant(page).getByText("Live", { exact: true }),
      ).toBeVisible();

      // The header is the founder's brief from the same stored session.
      const header = page.getByRole("region", {
        name: "Workspace",
        exact: true,
      });
      await expect(
        header.getByText("Los Angeles", { exact: true }),
      ).toBeVisible();
      await expect(header.getByText("Quick-service food")).toBeVisible();
      expect((await savedSession(page))?.profile.rent).toEqual({
        value: "4550",
        origin: "founder",
      });

      // Invented real-listing API fixtures exercise identity continuity; no preview property is substituted.
      const location = page.getByRole("region", { name: "Selected location" });
      await expect(location).toContainText("101 Invented St");
      await expect(
        location.getByText("Unknown", { exact: true }),
      ).toBeVisible();
      await expect(location).toContainText("1,250 sq ft");
      await expect(
        page.getByRole("group", { name: "Matching locations" }),
      ).toBeVisible();
      await expect(location.getByText("Example", { exact: true })).toHaveCount(
        0,
      );
      await expect(
        page.getByText("City preview · photo, not a map", { exact: true }),
      ).toHaveCount(0);
      await expect(
        page.getByText("Montrose storefront", { exact: true }),
      ).toHaveCount(0);
      await expect(
        assistant(page).getByText(
          "Staffing changes and Keep/Revert are not connected yet.",
        ),
      ).toBeVisible();
      await expectNoOverflow(page);

      // Edit brief resumes the same review without inventing a selected example space.
      const edit = page.getByRole("link", { name: "Edit brief" });
      await expect(edit).toHaveAttribute(
        "href",
        `/projects/houston-coffee/intake?site=${encodeURIComponent(liveSiteId)}`,
      );
      await closeConsultant(page);
      await edit.click();
      await expect(title(page)).toHaveText("Review your business");
      await page.getByRole("button", { name: "Edit monthly rent" }).click();
      await page.getByRole("textbox", { name: /exact amount/ }).fill("5200");
      await proceed(page).click();
      await expect(title(page)).toHaveText("Review your business");
      const revisedSearch = page.waitForRequest(
        (request) =>
          request.url().endsWith("/api/sites") && request.method() === "POST",
      );
      await page.getByRole("link", { name: "Open workspace" }).click();
      expect(
        (await revisedSearch).postDataJSON().profile.economics
          .monthlyRentCeilingCents.value,
      ).toBe(520000);
      await expect(location).toContainText("101 Invented St");
      await expect(page).toHaveURL(
        new RegExp(`site=${encodeURIComponent(liveSiteId)}`),
      );
      expect((await savedSession(page))?.profile.rent).toEqual({
        value: "5200",
        origin: "founder",
      });
    });
  });
}

test("one conversation and one draft follow the founder across Text, Voice, Edit brief and reload", async ({
  page,
}) => {
  const { state, messages, held } = await mockServices(page);
  await completeOnboarding(page);
  state.live = true;
  await page.getByRole("link", { name: "Open workspace" }).click();
  await openWorkspaceConsultant(page);
  await expect(
    assistant(page).getByText("Live", { exact: true }),
  ).toBeVisible();

  // A draft survives the Voice tab, a trip to Edit brief and back, and a reload.
  await composer(page).fill("Is parking nearby?");
  await tab(page, "Voice").click();
  await tab(page, "Text").click();
  await expect(composer(page)).toHaveValue("Is parking nearby?");
  await closeConsultant(page);
  await page.getByRole("link", { name: "Edit brief" }).click();
  await expect(title(page)).toHaveText("Review your business");
  await page.getByRole("link", { name: "Open workspace" }).click();
  await openWorkspaceConsultant(page);
  await expect(composer(page)).toHaveValue("Is parking nearby?");
  await page.reload();
  await openConsultant(page);
  await expect(composer(page)).toHaveValue("Is parking nearby?");
  await expect(
    assistant(page).getByText("Live", { exact: true }),
  ).toBeVisible();

  // The typed message is the real intake action: one request, the actual reply is shown.
  await composer(page).press("Enter");
  await expect.poll(() => held.length).toBe(1);
  expect(messages[0]!.message).toBe("Is parking nearby?");
  await held[0]!.fulfill({ json: reply("Street parking is limited.") });
  await expect(log(page)).toContainText("Street parking is limited.");
  await expect(composer(page)).toHaveValue("");
  expect(
    await page.evaluate((key) => sessionStorage.getItem(key), draftKey),
  ).toBeNull();

  // Voice shows the same history on demand.
  await tab(page, "Voice").click();
  await assistant(page).getByText("Conversation", { exact: true }).click();
  await expect(log(page)).toContainText("Is parking nearby?");
  await expect(log(page)).toContainText("Street parking is limited.");

  // The history lives in the intake session, so a reload and the detailed form show it too.
  await page.reload();
  await openConsultant(page);
  await tab(page, "Voice").click();
  await assistant(page).getByText("Conversation", { exact: true }).click();
  await expect(log(page)).toContainText("Street parking is limited.");
  await page.goto(`${workspaceHref("houston-coffee", "intake")}?mode=form`);
  const formLog = page.getByRole("list", { name: "Conversation" });
  await expect(formLog).toContainText("Is parking nearby?");
  await expect(formLog).toContainText("Street parking is limited.");
  const session = await savedSession(page);
  expect(
    session?.messages.filter((entry) => entry.text === "Is parking nearby?"),
  ).toHaveLength(1);

  // HAC-143: the detailed form has no composer of its own. The consultant dock stays
  // mounted, so its draft follows the founder there and sending uses the same action.
  await page.goto(workspaceHref("houston-coffee", "workspace"));
  await openConsultant(page);
  await tab(page, "Text").click();
  await composer(page).fill("Second thought");
  await closeConsultant(page);
  await page.getByRole("link", { name: "Edit brief" }).click();
  await page.getByRole("link", { name: "Edit all fields" }).click();
  await expect(
    page.getByRole("heading", { level: 2, name: "Business profile" }),
  ).toBeVisible();
  await openConsultant(page);
  await expect(composer(page)).toHaveValue("Second thought");
  await composer(page).press("Enter");
  await expect.poll(() => held.length).toBe(2);
  expect(messages[1]!.message).toBe("Second thought");
  await held[1]!.fulfill({ json: reply("Noted from the form.") });
  await expect(formLog).toContainText("Noted from the form.");
  await closeConsultant(page);
  await page.getByRole("link", { name: "Back to guided setup" }).click();
  await page.getByRole("link", { name: "Open workspace" }).click();
  await openWorkspaceConsultant(page);
  await expect(log(page)).toContainText("Noted from the form.");
  await expect(log(page)).toContainText("Second thought");
});

test("the offline assistant keeps its draft and invents no reply, even after Edit brief", async ({
  page,
}) => {
  await mockServices(page);
  await completeOnboarding(page);
  await page.getByRole("link", { name: "Open workspace" }).click();
  await openWorkspaceConsultant(page);
  await expect(
    assistant(page).getByText("Offline", { exact: true }),
  ).toBeVisible();
  await composer(page).fill("Anyone there?");
  await composer(page).press("Enter");
  await expect(assistant(page).getByRole("alert")).toContainText(
    "nothing was sent",
  );
  await closeConsultant(page);
  await page.getByRole("link", { name: "Edit brief" }).click();
  await page.getByRole("link", { name: "Open workspace" }).click();
  await openWorkspaceConsultant(page);
  await expect(composer(page)).toHaveValue("Anyone there?");
  await expect(log(page)).not.toContainText("Anyone there?");
});

test("the finish and the workspace work from the keyboard, with a visible focus indicator", async ({
  page,
}) => {
  await mockServices(page);
  await completeOnboarding(page);
  const open = page.getByRole("link", { name: "Open workspace" });
  await open.focus();
  await expect(open).toBeFocused();
  await page.keyboard.press("Enter");
  await expect(
    page.getByRole("heading", { level: 1, name: "Workspace" }),
  ).toBeVisible();

  // Edit brief is reachable by Tab and opens with Enter.
  const edit = page.getByRole("link", { name: "Edit brief" });
  await edit.focus();
  await expect(edit).toBeFocused();
  const outline = await edit.evaluate(
    (el) => getComputedStyle(el).outlineStyle,
  );
  expect(outline).not.toBe("none");

  // The assistant tabs are one tab stop; arrows move between Text and Voice.
  await openConsultant(page);
  await tab(page, "Text").focus();
  await page.keyboard.press("ArrowRight");
  await expect(tab(page, "Voice")).toBeFocused();
  await expect(tab(page, "Voice")).toHaveAttribute("aria-selected", "true");
  await page.keyboard.press("ArrowLeft");
  await expect(tab(page, "Text")).toBeFocused();
  await expectNoA11yViolations(page);

  await edit.focus();
  await page.keyboard.press("Enter");
  await expect(
    page.getByRole("heading", { name: "Review your business" }),
  ).toBeVisible();
});

test("the workspace plays no animation under reduced motion", async ({
  page,
}) => {
  await page.emulateMedia({ reducedMotion: "reduce" });
  await mockServices(page);
  await completeOnboarding(page);
  await page.getByRole("link", { name: "Open workspace" }).click();
  await openWorkspaceConsultant(page);
  await expect(
    assistant(page).getByText("Offline", { exact: true }),
  ).toBeVisible();
  const running = () =>
    page.evaluate(
      () =>
        document.getAnimations().filter((a) => a.playState === "running")
          .length,
    );
  await expect.poll(running).toBe(0);
  await tab(page, "Voice").click();
  await expect(
    page.getByRole("region", { name: "Voice assistant" }),
  ).toBeVisible();
  await expect.poll(running).toBe(0);
});

test("the guided stage is dark glass on the photo, one question at a time, with the credit", async ({
  page,
}) => {
  await mockServices(page);
  await page.goto(workspaceHref("houston-coffee", "intake"));
  await expect(title(page)).toHaveText("What are you opening?");
  // One page heading and no second page title or white card around the stage.
  await expect(page.getByRole("heading", { level: 1 })).toHaveCount(1);
  const glass = page.getByRole("region", { name: "What are you opening?" });
  const style = await glass.evaluate((el) => {
    const css = getComputedStyle(el);
    return { fill: css.backgroundColor, blur: css.backdropFilter };
  });
  expect(style.fill).toBe("rgba(15, 16, 21, 0.4)");
  expect(style.blur).toBe("blur(16px)");
  await expect(
    page.getByRole("button", { name: "Other Coming soon" }),
  ).toBeDisabled();
  await expect(
    page.getByRole("link", { name: "Carol M. Highsmith" }),
  ).toBeVisible();
  await expect(page.getByText("Step 2 of")).toHaveCount(0);
});
