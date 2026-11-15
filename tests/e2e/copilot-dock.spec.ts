import type { Page } from "@playwright/test";
import {
  closeConsultant,
  expect,
  expectNoA11yViolations,
  openConsultant,
  test,
  PROJECT_ID,
} from "./fixtures";

/**
 * HAC-84: the copilot dock lives in the project layout and talks to HAC-83's runtime.
 * The copilot and scenario routes are stubbed here so the spec needs no database and
 * makes no model call; the stubbed events follow lib/contracts/copilot-runtime.ts.
 */
const tree = {
  tree: [
    {
      scenario: {
        id: "base",
        parentId: null,
        label: "Baseline",
        author: "founder",
        createdAt: "2026-11-14T10:00:00.000Z",
      },
      children: ["early"],
    },
    {
      scenario: {
        id: "early",
        parentId: "base",
        label: "Open at 6am",
        author: "agent",
        createdAt: "2026-11-14T11:00:00.000Z",
      },
      children: [],
    },
  ],
};

const context = {
  projectId: PROJECT_ID,
  scenarioId: "base",
  page: `/projects/${PROJECT_ID}/map`,
  view: "city",
  revision: 1,
};
const envelope = (turnId: string, sequence: number) => ({
  threadId: "thread",
  turnId,
  sequence,
  context,
});
const proposal = (status: string) => ({
  id: "call-1",
  baseScenarioId: "base",
  proposedScenarioId: "early",
  title: "Proposed change",
  description: "Review the set_hours change before running or keeping it.",
  status,
  evidenceIds: [],
});
const snapshotEvents = [
  { type: "turn_started", requestId: "r0" },
  { type: "tool_started", callId: "call-1", tool: "set_hours" },
  {
    type: "tool_completed",
    callId: "call-1",
    tool: "set_hours",
    sources: [],
    result: {
      status: "created",
      scenarioId: "early",
      parentId: "base",
      diff: {
        sites: { added: [], removed: [] },
        changedPaths: ["overrides.hours.weekday.openMinute"],
        values: [],
      },
    },
  },
  { type: "proposal", proposal: proposal("pending") },
  { type: "turn_finished", status: "completed", message: "Proposal saved." },
].map((event, i) => ({
  seq: i + 1,
  payload: { ...envelope("t0", i), ...event },
}));

const sse = (turnId: string, events: Record<string, unknown>[]) =>
  events
    .map(
      (event, i) =>
        `data: ${JSON.stringify({ ...envelope(turnId, i), ...event })}\n\n`,
    )
    .join("");

async function stubScenarios(page: Page) {
  await page.route(`**/api/projects/${PROJECT_ID}/scenarios`, (route) =>
    route.fulfill({ json: tree }),
  );
}

function dockOf(page: Page) {
  return page.getByRole("complementary", { name: /^Copilot/ });
}

test("a 503 shows a useful unavailable state; the dock survives navigation and passes axe", async ({
  page,
  gotoView,
}) => {
  await stubScenarios(page);
  await page.route(`**/api/projects/${PROJECT_ID}/copilot`, (route) =>
    route.fulfill({
      status: 503,
      json: {
        code: "COPILOT_UNAVAILABLE",
        message: "Copilot is temporarily unavailable.",
      },
    }),
  );
  await gotoView("map");
  // HAC-143: the copilot sits in the consultant dock (a closed sheet on a phone).
  await openConsultant(page);
  const dock = dockOf(page);
  const toggle = dock.getByRole("button", { name: "Show copilot" });
  await expect(toggle).toHaveAttribute("aria-expanded", "false");

  await toggle.focus();
  await page.keyboard.press("Enter");
  await expect(
    dock.getByRole("button", { name: "Hide copilot" }),
  ).toHaveAttribute("aria-expanded", "true");
  await expect(
    dock.getByText(/copilot is unavailable right now/i),
  ).toBeVisible();
  await expect(dock.getByRole("button", { name: "Try again" })).toBeVisible();
  // No composer while the runtime is down, so nothing can be sent into a void.
  await expect(dock.getByLabel("Message the copilot")).toHaveCount(0);

  await dock.getByLabel(/Active scenario/).selectOption("early");
  await expectNoA11yViolations(page);

  // Client navigation keeps the layout, and with it the dock, mounted. On a phone the
  // founder closes the consultant sheet to reach the page's navigation.
  await closeConsultant(page);
  await page
    .getByRole("navigation", { name: "Project views" })
    .getByRole("link", { name: "Comparison", exact: true })
    .first()
    .click();
  await expect(page).toHaveURL(/\/comparison/);
  await openConsultant(page);
  await expect(
    dock.getByRole("button", { name: "Hide copilot" }),
  ).toBeVisible();
  await expect(dock.getByLabel(/Active scenario/)).toHaveValue("early");

  // A reload in the same tab restores it from session storage.
  await page.reload();
  await openConsultant(page);
  await expect(dock.getByLabel(/Active scenario/)).toHaveValue("early");
});

test("one diff card per mutation; Keep and Revert work from the keyboard", async ({
  page,
  gotoView,
}) => {
  await stubScenarios(page);
  const turns: unknown[] = [];
  await page.route(`**/api/projects/${PROJECT_ID}/copilot`, async (route) => {
    if (route.request().method() === "GET")
      return route.fulfill({ json: { messages: [], events: snapshotEvents } });
    const body = route.request().postDataJSON() as {
      proposalAction?: { action: string };
    };
    turns.push(body);
    const status = body.proposalAction?.action === "keep" ? "kept" : "reverted";
    const turnId = `t${turns.length}`;
    return route.fulfill({
      headers: { "Content-Type": "text/event-stream" },
      body: sse(turnId, [
        { type: "turn_started", requestId: `r${turns.length}` },
        { type: "proposal", proposal: proposal(status) },
        { type: "turn_finished", status: "completed", message: "Saved." },
      ]),
    });
  });
  await gotoView("map");
  // HAC-143: the copilot sits in the consultant dock (a closed sheet on a phone).
  await openConsultant(page);
  const dock = dockOf(page);
  await dock.getByRole("button", { name: "Show copilot" }).click();
  const cards = dock.getByTestId("copilot-diff-card");
  await expect(cards).toHaveCount(1);
  await expect(cards.first()).toContainText("Changed opening hours");
  await expect(cards.first()).toContainText("Weekday opening time");
  await expectNoA11yViolations(page);

  const keep = cards.first().getByRole("button", { name: /^Keep:/ });
  await keep.focus();
  await page.keyboard.press("Enter");
  await expect(cards.first().getByRole("status")).toContainText("Kept");
  await expect(cards).toHaveCount(1);
  expect(turns[0]).toMatchObject({
    proposalAction: { proposalId: "call-1", action: "keep" },
    context: { scenarioId: "base", projectId: PROJECT_ID },
  });
  // Keep makes the proposed scenario the active one for every page.
  await expect(dock.getByLabel(/Active scenario/)).toHaveValue("early");
  await expect(
    cards.first().getByRole("button", { name: /^Revert:/ }),
  ).toBeDisabled();
});

test("Revert saves a revert version through the scenario route", async ({
  page,
  gotoView,
}) => {
  await stubScenarios(page);
  await page.route(`**/api/projects/${PROJECT_ID}/copilot`, async (route) => {
    if (route.request().method() === "GET")
      return route.fulfill({ json: { messages: [], events: snapshotEvents } });
    return route.fulfill({
      headers: { "Content-Type": "text/event-stream" },
      body: sse("t1", [
        { type: "turn_started", requestId: "r1" },
        { type: "proposal", proposal: proposal("reverted") },
        { type: "turn_finished", status: "completed", message: "Saved." },
      ]),
    });
  });
  let revertBody: unknown = null;
  await page.route(
    `**/api/projects/${PROJECT_ID}/scenarios/early/revert-to`,
    async (route) => {
      revertBody = route.request().postDataJSON();
      await route.fulfill({
        status: 201,
        json: { scenario: { id: "early-revert" } },
      });
    },
  );

  await gotoView("map");
  // HAC-143: the copilot sits in the consultant dock (a closed sheet on a phone).
  await openConsultant(page);
  const dock = dockOf(page);
  await dock.getByRole("button", { name: "Show copilot" }).click();
  const card = dock.getByTestId("copilot-diff-card").first();
  const revert = card.getByRole("button", { name: /^Revert:/ });
  await revert.focus();
  await page.keyboard.press("Space");
  await expect(card).toContainText("revert version (early-revert)");
  expect(revertBody).toMatchObject({ targetId: "base", author: "founder" });
  await expect(dock.getByTestId("copilot-diff-card")).toHaveCount(1);
});
