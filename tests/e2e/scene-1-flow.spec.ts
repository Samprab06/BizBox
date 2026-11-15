import type { Page } from "@playwright/test";
import { expect as baseExpect, test } from "./fixtures";
import {
  mockLiveComparison,
  threeSiteComparison,
  threeSiteIds,
  threeSiteSearch,
} from "./live-comparison-fixtures";

// Scene 1: the guided flow end to end with one consultant in the dock. Every boundary is a
// page.route mock: scripted consultant replies and actions, invented listings and a seeded
// comparison. No model, Jev, database or listing service is called.

const reply = (
  assistantMessage: string,
  actions: Record<string, unknown>[] = [],
) => ({
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
  actions: actions.map((action, index) => ({
    id: `act-${assistantMessage.length}-${index}`,
    ...action,
  })),
});

type IntakePost = {
  message?: string;
  event?: { kind: string; [key: string]: unknown };
  view?: Record<string, unknown>;
};

async function services(page: Page) {
  await mockLiveComparison(page, { jevConfigured: true });
  await page.route("**/api/sites", (route) =>
    route.fulfill({ json: threeSiteSearch }),
  );
  await page.route("**/api/voice/session", (route) =>
    route.fulfill({ json: { configured: false } }),
  );
  await page.route("**/api/sites/*/interior", (route) =>
    route.fulfill({ status: 404, json: {} }),
  );
  const posts: IntakePost[] = [];
  await page.route("**/api/projects/*/intake", (route) => {
    if (route.request().method() === "GET")
      return route.fulfill({ json: { modelConfigured: true } });
    const body = route.request().postDataJSON() as IntakePost;
    posts.push(body);
    const kind = body.event?.kind;
    if (kind === "arrived_workspace")
      return route.fulfill({
        json: reply("Here are your top 3 locations, best first.", [
          { type: "present_top_sites", siteIds: [...threeSiteIds] },
        ]),
      });
    if (kind)
      return route.fulfill({ json: reply(`Noted: ${kind.replace("_", " ")}.`) });
    const text = body.message ?? "";
    if (/compare them/i.test(text))
      return route.fulfill({
        json: reply("Running the comparison of all three now.", [
          { type: "run_comparison", siteIds: [...threeSiteIds] },
        ]),
      });
    if (/\$7 ticket/i.test(text))
      return route.fulfill({
        json: reply("Trying a $7 average ticket at 101 Invented St.", [
          {
            type: "set_site_tweaks",
            candidateId: threeSiteIds[0],
            tweaks: { priceUsd: 7 },
          },
          { type: "run_comparison", siteIds: [...threeSiteIds] },
        ]),
      });
    if (/go with/i.test(text))
      return route.fulfill({
        json: reply("Great choice. Here is your plan.", [
          {
            type: "finalize_plan",
            comparisonId: "comparison-scene-1-run-2",
            chosenSiteId: threeSiteIds[0],
            rationale: "Highest modeled contribution with the $7 ticket.",
          },
        ]),
      });
    return route.fulfill({ json: reply("Okay.") });
  });
  // POST /api/comparisons: the first run is a deadline-limited Jev panel (202 twice).
  const runs: { candidateIds: string[]; siteTweaks?: unknown }[] = [];
  const stored = new Map<string, ReturnType<typeof threeSiteComparison>>();
  let calls = 0;
  await page.route("**/api/comparisons", (route) => {
    const body = route.request().postDataJSON();
    calls++;
    if (calls <= 2)
      return route.fulfill({
        status: 202,
        json: {
          status: "in_progress",
          message: "Jev panel in progress",
          completedPersonas: calls === 1 ? 10 : 25,
          totalPersonas: 40,
        },
      });
    runs.push({ candidateIds: body.candidateIds, siteTweaks: body.siteTweaks });
    const id = `comparison-scene-1-run-${runs.length}`;
    const payload = threeSiteComparison(body.candidateIds, id);
    stored.set(id, payload);
    return route.fulfill({ status: 201, json: payload });
  });
  await page.route("**/api/comparisons/comparison-scene-1-*/plan?*", (route) =>
    route.fulfill({ status: 404, json: {} }),
  );
  await page.route("**/api/comparisons/comparison-scene-1-*", (route) => {
    const url = new URL(route.request().url());
    const id = url.pathname.split("/")[3];
    if (url.pathname.endsWith("/plan"))
      return route.fulfill({ status: 404, json: {} });
    const payload = stored.get(id);
    return payload
      ? route.fulfill({ json: payload })
      : route.fulfill({ status: 404, json: {} });
  });
  return { posts, runs };
}

// The dev server compiles routes on first use, so waits here are generous.
const expect = baseExpect.configure({ timeout: 20_000 });

const events = (posts: IntakePost[]) =>
  posts.flatMap((post) => (post.event ? [post.event] : []));

/** The header stepper's status for one step (current, reached or locked). */
const stepStatus = (page: Page, step: string) =>
  page
    .getByRole("navigation", { name: "Progress" })
    .locator(`[data-flow-step="${step}"]`);

test.use({ viewport: { width: 1440, height: 960 } });

test("Scene 1: top 3 greeting, agent-run comparison with progress, tweak and rerun, final plan", async ({
  page,
}) => {
  test.setTimeout(180_000);
  const { posts, runs } = await services(page);
  await page.goto("/projects/houston-coffee/workspace?step=locations");

  // Step 2: the dock is open and the consultant greets once with the top 3.
  const log = page
    .getByRole("complementary", { name: "Assistant" })
    .getByRole("log", { name: "Conversation" });
  await expect(log).toContainText("Here are your top 3 locations");
  const top = page.getByRole("region", { name: "Top locations" });
  await expect(top).toContainText("Your top locations");
  await expect(top.getByRole("listitem")).toHaveCount(3);
  await expect(top.getByRole("listitem").first()).toContainText(
    "101 Invented St",
  );
  // With nothing chosen yet, the presented top 3 become the shortlist.
  await expect(
    page.getByRole("region", { name: "Comparison shortlist" }),
  ).toContainText("Comparison 3/3");
  const arrival = posts.find((post) => post.event?.kind === "arrived_workspace");
  expect(arrival?.view).toMatchObject({
    stage: "workspace",
    step: "locations",
    candidateIds: [...threeSiteIds],
  });
  expect((arrival?.view?.candidates as unknown[]).length).toBe(3);
  expect(events(posts).filter((e) => e.kind === "arrived_workspace")).toHaveLength(1);

  // The agent runs the comparison: the compare step shows persona progress.
  const composer = page.getByRole("textbox", {
    name: "Message the BizBox assistant",
  });
  await composer.fill("Compare them");
  await composer.press("Enter");
  await expect(page).toHaveURL(/step=compare/);
  const progress = page.getByRole("region", { name: "Comparison progress" });
  await expect(progress).toContainText("Jev customer panel");
  await expect(progress).toContainText(/Jev personas answering: (10|25) of 40/);
  await expect(progress).toContainText("Jev runs can take a few minutes");
  await expect(progress).toContainText("303 Invented Ave");
  await expect(progress.getByRole("status")).toContainText("Customer panel");
  await expect(
    progress.getByRole("progressbar", { name: "Jev personas answered" }),
  ).toHaveAttribute("aria-valuemax", "40");
  await expect(progress).toContainText("25 of 40");

  // A finished matching comparison opens the results step.
  await expect(page).toHaveURL(/step=results/, { timeout: 20_000 });
  await expect(
    page.getByRole("region", { name: "Location comparison results" }),
  ).toBeVisible();
  // The stepper follows the workspace: results is current, compare reached, finalize locked.
  await expect(stepStatus(page, "results")).toHaveAttribute(
    "data-flow-status",
    "current",
  );
  await expect(stepStatus(page, "compare")).toHaveAttribute(
    "data-flow-status",
    "reached",
  );
  await expect(stepStatus(page, "finalize")).toHaveAttribute(
    "data-flow-status",
    "locked",
  );
  expect(runs[0]).toEqual({ candidateIds: [...threeSiteIds] });
  await expect
    .poll(() => events(posts).map((e) => e.kind))
    .toEqual([
      "arrived_workspace",
      "comparison_started",
      "comparison_progress",
      "comparison_progress",
      "comparison_finished",
    ]);
  expect(events(posts)[1]).toEqual({
    kind: "comparison_started",
    siteIds: [...threeSiteIds],
    demandSource: "jev",
  });
  expect(events(posts)[2]).toEqual({
    kind: "comparison_progress",
    completed: 10,
    total: 40,
  });
  expect(events(posts)[4]).toEqual({
    kind: "comparison_finished",
    comparisonId: "comparison-scene-1-run-1",
  });

  // The agent tweaks one site and reruns; the request carries the tweak.
  await composer.fill("Try a $7 ticket at the first one");
  await composer.press("Enter");
  await expect.poll(() => runs.length, { timeout: 20_000 }).toBe(2);
  expect(runs[1]).toEqual({
    candidateIds: [...threeSiteIds],
    siteTweaks: { [threeSiteIds[0]]: { priceUsd: 7 } },
  });
  await expect(page).toHaveURL(/step=results/);
  const results = page.getByRole("region", { name: "Results", exact: true });
  await expect(results).toContainText("Changes in this run");
  await expect(results).toContainText("Avg ticket $7.00");
  await expect(
    results.getByRole("button", { name: "Change a site", exact: true }),
  ).toBeVisible();
  await expect(
    results.getByRole("button", { name: "Rerun", exact: true }),
  ).toBeVisible();

  // The agent finalizes: the final plan step shows the chosen site.
  await composer.fill("Let's go with 101 Invented St");
  await composer.press("Enter");
  await expect(page).toHaveURL(/step=finalize/);
  await expect(stepStatus(page, "finalize")).toHaveAttribute(
    "data-flow-status",
    "current",
  );
  await expect(
    page.getByRole("heading", { name: "101 Invented St", exact: true }),
  ).toBeVisible();
  await expect(page.getByText("Highest modeled contribution")).toBeVisible();
  await page.screenshot({ path: "/tmp/bizbox-scene-1-finalize.png" });
});

test("Scene 1: the questionnaire shows no dock, a manual 3-unit compare reaches results, a locked step redirects", async ({
  page,
}) => {
  test.setTimeout(120_000);
  await services(page);
  await page.goto("/projects/houston-coffee/intake");
  await expect(page.locator("[data-consultant-layout]")).toHaveAttribute(
    "data-consultant-layout",
    "hidden",
  );
  await expect(
    page.getByRole("complementary", { name: "Assistant" }),
  ).toHaveCount(0);

  // Results are locked before any comparison: the workspace shows the furthest open step
  // (locations, or compare once the greeting has shortlisted the top 3).
  await page.goto("/projects/houston-coffee/workspace?step=results");
  await expect(page).toHaveURL(/step=(locations|compare)/);
  await expect(
    page.getByRole("complementary", { name: "Assistant" }),
  ).toBeVisible();
  await page.goto("/projects/houston-coffee/workspace?step=locations");
  const tray = page.getByRole("region", { name: "Comparison shortlist" });
  await expect(tray).toContainText("Comparison 3/3");
  await tray.getByRole("button", { name: "Compare 3 units" }).click();
  await expect(page).toHaveURL(/step=compare/);
  const comparison = page.getByRole("region", { name: "Unit comparison" });
  await expect(
    comparison.getByRole("table", {
      name: "Source listing facts for the three chosen units",
    }),
  ).toBeVisible();
  await comparison
    .getByRole("button", { name: "Run comparison", exact: true })
    .click();
  await expect(
    page.getByRole("region", { name: "Comparison progress" }),
  ).toBeVisible();
  await expect(page).toHaveURL(/step=results/, { timeout: 20_000 });
  await expect(
    page.getByRole("region", { name: "Location comparison results" }),
  ).toBeVisible();
});
