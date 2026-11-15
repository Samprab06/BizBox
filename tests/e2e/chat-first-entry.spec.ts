import type { Page, Route } from "@playwright/test";
import { founderAnswers } from "../../lib/agent/__fixtures__/founder";
import type { IntakeState } from "../../lib/contracts/intake";
import { workspaceHref } from "../../lib/client/workspace-routes";
import {
  expect,
  expectNoA11yViolations,
  openConsultant,
  test,
} from "./fixtures";

// HAC-150: a project opens as a full-screen chat; the guided answer cards sit inline; the
// shell docks onto Spaces once the brief is complete or the agent navigates. Every network
// boundary is a page.route mock: the intake model is scripted, nothing paid is called.

const PROJECT = "p-0123456789abcdef0123";
const STORAGE_KEY = `sitework:intake:v1:${PROJECT}`;
const ENTRY = new RegExp(`/projects/${PROJECT}$`);
const SPACES = new RegExp(`/projects/${PROJECT}/workspace$`);

const layout = (page: Page) => page.locator("[data-consultant-layout]");
const assistant = (page: Page) =>
  page.getByRole("complementary", { name: "Assistant" });
const log = (page: Page) =>
  assistant(page).getByRole("log", { name: "Conversation" });
const composer = (page: Page) =>
  assistant(page).getByRole("textbox", {
    name: "Message the BizBox assistant",
  });
const card = (page: Page, title: string) =>
  assistant(page)
    .getByRole("region", { name: "Answer card" })
    .filter({
      has: page.getByRole("heading", { name: title }),
    });

const defaultValue = (value: number, unit: string) => ({
  value,
  unit,
  origin: "default" as const,
  evidenceIds: ["category-default"],
});

/** The reply for one scripted model turn: the recorded save_profile patch merged into the state. */
function response(
  state: IntakeState | undefined,
  patch: Record<string, unknown>,
  message: string,
  complete: boolean,
  actions?: unknown[],
) {
  const old = state ?? { draft: {}, assumptions: {} };
  const previous = old.draft;
  const { assumptions: overridden, ...fields } = patch;
  const draft = {
    ...previous,
    ...fields,
    capacity: {
      ...previous.capacity,
      ...(patch.capacity as object | undefined),
    },
    economics: {
      ...previous.economics,
      ...(patch.economics as object | undefined),
    },
    derivedDefaults: { ...previous.derivedDefaults },
    ...(previous.category || patch.category
      ? { category: (patch.category ?? previous.category) as "coffee" }
      : {}),
  };
  if (draft.category === "coffee" && !draft.capacity.serviceMinutes)
    draft.capacity.serviceMinutes = defaultValue(5, "minutes");
  if (draft.category === "coffee" && !draft.derivedDefaults.travelMinutes)
    draft.derivedDefaults = {
      travelMinutes: defaultValue(10, "minutes"),
      patienceMinutes: defaultValue(8, "minutes"),
      wageRateCentsPerHour: defaultValue(1800, "USD cents/hour"),
      cogsFraction: defaultValue(0.25, "fraction"),
    };
  const assumptions = { ...old.assumptions };
  if (draft.category === "coffee" && !assumptions.visitsPerMonth)
    assumptions.visitsPerMonth = defaultValue(4, "visits/month");
  if (overridden) Object.assign(assumptions, overridden);
  return {
    persisted: false,
    draft,
    assumptions,
    profile: null,
    missingRequiredFields: complete ? [] : ["remaining founder answers"],
    findings: [],
    questions: [],
    nextQuestion: complete ? null : { question: "What else should I know?" },
    defaultSources: [],
    assistantMessage: message,
    ...(actions ? { actions } : {}),
  };
}

/**
 * The scripted interview, one turn per answer: category (card), customers (typed), city
 * (card), rent (ruler card; the model also records buildout and price), hours and staff
 * (typed), must-haves (typed). The last turn completes the brief.
 */
const script = [
  { patch: founderAnswers[0], reply: "Great. Who is it for?" },
  { patch: founderAnswers[4], reply: "Which city?" },
  { patch: founderAnswers[1], reply: "What is your monthly rent limit?" },
  {
    patch: {
      economics: {
        ...founderAnswers[2].economics,
        ...founderAnswers[3].economics,
      },
    },
    reply: "When will you be open, and how many people on shift?",
  },
  { patch: founderAnswers[5], reply: "Anything the space must have?" },
  {
    patch: founderAnswers[6],
    reply: "Your brief is complete. Here are spaces.",
  },
] as const;

async function mockModel(page: Page, navigateAt?: number) {
  const posts: { message?: string }[] = [];
  let state: IntakeState | undefined;
  await page.route(
    `**/api/projects/${PROJECT}/intake`,
    async (route: Route) => {
      if (route.request().method() === "GET")
        return route.fulfill({ json: { modelConfigured: true } });
      const request = route.request().postDataJSON() as { message?: string };
      posts.push(request);
      const turn = script[posts.length - 1]!;
      const last = posts.length === script.length;
      const reply = response(
        state,
        turn.patch,
        turn.reply,
        last,
        posts.length === navigateAt
          ? [{ id: "nav-1", type: "navigate", stage: "map" }]
          : undefined,
      );
      state = {
        draft: reply.draft,
        assumptions: reply.assumptions,
      } as IntakeState;
      await route.fulfill({ json: reply });
    },
  );
  return posts;
}

async function mockServices(page: Page) {
  await page.route("**/api/projects", (route) =>
    route.request().method() === "POST"
      ? route.fulfill({
          status: 201,
          json: { id: PROJECT, name: "New project" },
        })
      : route.fallback(),
  );
  await page.route("**/api/voice/session", (route) =>
    route.request().method() === "GET"
      ? route.fulfill({ json: { configured: false } })
      : route.fulfill({ status: 503, json: { message: "not used" } }),
  );
  await page.route("**/api/sites**", (route) =>
    route.fulfill({ status: 503, json: { message: "not used" } }),
  );
}

async function type(page: Page, text: string, turn: number, posts: unknown[]) {
  await composer(page).fill(text);
  // Recording the previous POST can precede its reply and the composer becoming ready.
  await expect(
    assistant(page).getByRole("button", { name: "Send message", exact: true }),
  ).toBeEnabled();
  await composer(page).press("Enter");
  await expect.poll(() => posts.length).toBe(turn);
}

/** Answers every question with the cards and typed messages. Stops before the last turn when asked. */
async function answerBrief(
  page: Page,
  posts: unknown[],
  through: number = script.length,
) {
  await expect(layout(page)).toHaveAttribute("data-consultant-layout", "focus");
  await expect(log(page)).toContainText(
    "What kind of business are you opening?",
  );
  // Turn 1: the category chips.
  await card(page, "What are you opening?")
    .getByRole("button", { name: "Coffee shop" })
    .click();
  await expect.poll(() => posts.length).toBe(1);
  if (through < 2) return;
  await expect(log(page)).toContainText("Who is it for?");
  await type(page, "Nearby residents and commuters.", 2, posts);
  if (through < 3) return;
  // Turn 3: the city chips.
  await card(page, "Where are you looking?")
    .getByRole("button", { name: "Houston" })
    .click();
  await expect.poll(() => posts.length).toBe(3);
  if (through < 4) return;
  // Turn 4: the curved ruler's starting amount ($4,500) is confirmed.
  await card(page, "What’s your monthly rent limit?")
    .getByRole("button", { name: /^Confirm \$4,500$/ })
    .click();
  await expect.poll(() => posts.length).toBe(4);
  if (through < 5) return;
  await expect(log(page)).toContainText("When will you be open");
  await type(page, "Open 7am to 5pm with two people on shift.", 5, posts);
  if (through < 6) return;
  await type(page, "Frontage and ground floor required.", 6, posts);
}

async function openFromLanding(page: Page) {
  await page.goto("/");
  await expect(
    page.getByRole("heading", {
      level: 1,
      name: "Test business decisions before committing.",
    }),
  ).toBeAttached();
  await page.waitForFunction(
    () =>
      (window as unknown as { bizboxReady?: boolean }).bizboxReady === true ||
      document.body.classList.contains("ready"),
  );
  await page.locator(".nav-cta").click();
  await expect(page).toHaveURL(ENTRY);
}

async function seedFinishedBrief(page: Page) {
  const founder = (value: string) => ({ value, origin: "founder" });
  await page.goto("/api/health");
  await page.evaluate(
    ([key, value]) => {
      localStorage.setItem(key!, value!);
      localStorage.setItem(
        "bizbox:current-project:v1",
        "p-0123456789abcdef0123",
      );
    },
    [
      STORAGE_KEY,
      JSON.stringify({
        profile: {
          concept: founder("Late-night dumpling counter"),
          category: founder("Quick-service food"),
          city: founder("Houston"),
          areas: founder("Favor Montrose"),
          rent: founder("4500"),
          buildout: founder("120000"),
          price: founder("Midrange"),
          customers: founder("Students and night-shift workers"),
          hours: founder("11am – 11pm"),
          staff: founder("3"),
          requirements: founder("Vent hood"),
        },
        messages: [
          { role: "agent", text: "What kind of business are you opening?" },
        ],
      }),
    ],
  );
}

test.beforeEach(async ({ page }) => {
  await mockServices(page);
});

test("first visit: landing, full-screen chat, answer cards, then the docked Spaces view", async ({
  page,
}) => {
  const posts = await mockModel(page);
  await openFromLanding(page);
  // Full screen: the consultant fills the page and the step view is hidden.
  await expect(layout(page)).toHaveAttribute("data-consultant-layout", "focus");
  await expect(page.locator("main")).toBeHidden();
  await expectNoA11yViolations(page);

  await answerBrief(page, posts, script.length - 1);
  // The answers so far are in the saved session, with their founder origin.
  const saved = JSON.parse(
    (await page.evaluate((key) => localStorage.getItem(key), STORAGE_KEY))!,
  );
  expect(saved.profile.category).toEqual({
    value: "Coffee shop",
    origin: "founder",
  });
  expect(saved.profile.city).toEqual({ value: "Houston", origin: "founder" });
  await expect(layout(page)).toHaveAttribute("data-consultant-layout", "focus");

  // The last answer completes the brief: no navigation by the founder.
  await type(page, "Frontage and ground floor required.", script.length, posts);
  await expect(page).toHaveURL(SPACES);
  await expect(layout(page)).toHaveAttribute(
    "data-consultant-layout",
    "docked",
  );
  await expect(layout(page)).toHaveAttribute(
    "data-dock-transition",
    "animated",
  );
  await expect(
    page.getByRole("heading", { level: 1, name: "Workspace" }),
  ).toBeVisible();
  // On a phone the docked consultant is a bottom sheet the founder opens.
  await openConsultant(page);
  await expect(assistant(page)).toHaveCount(1);
});

test("the agent's first navigate action docks the consultant and opens that step", async ({
  page,
}) => {
  const posts = await mockModel(page, 2);
  await page.goto("/start");
  await expect(page).toHaveURL(ENTRY);
  await answerBrief(page, posts, 2);
  await expect(page).toHaveURL(new RegExp(`/projects/${PROJECT}/map$`));
  await expect(layout(page)).toHaveAttribute(
    "data-consultant-layout",
    "docked",
  );
  // The conversation continues in the dock with its history.
  await openConsultant(page);
  await expect(log(page)).toContainText("Great. Who is it for?");
});

test("a returning founder with a complete brief lands docked on Spaces", async ({
  page,
}) => {
  await seedFinishedBrief(page);
  await page.goto("/start");
  await expect(page).toHaveURL(SPACES);
  await expect(layout(page)).toHaveAttribute(
    "data-consultant-layout",
    "docked",
  );
  await expect(layout(page)).toHaveAttribute("data-dock-transition", "none");
  await expect(
    page.getByRole("heading", { level: 1, name: "Workspace" }),
  ).toBeVisible();
  // The project's entry route does the same.
  await page.goto(`/projects/${PROJECT}`);
  await expect(page).toHaveURL(SPACES);
  await expect(layout(page)).toHaveAttribute(
    "data-consultant-layout",
    "docked",
  );
  // The guided intake stays reachable as the "Edit brief" view.
  await page.goto(workspaceHref(PROJECT, "intake"));
  await expect(page.locator("#onboarding-title")).toBeVisible();
});

test("reduced motion swaps the dock animation for a cut", async ({ page }) => {
  await page.emulateMedia({ reducedMotion: "reduce" });
  const posts = await mockModel(page);
  await page.goto("/start");
  await expect(page).toHaveURL(ENTRY);
  await answerBrief(page, posts, script.length - 1);
  await type(page, "Frontage and ground floor required.", script.length, posts);
  await expect(page).toHaveURL(SPACES);
  await expect(layout(page)).toHaveAttribute(
    "data-consultant-layout",
    "docked",
  );
  await expect(layout(page)).toHaveAttribute("data-dock-transition", "cut");
  expect(await page.evaluate(() => document.getAnimations().length)).toBe(0);
});
