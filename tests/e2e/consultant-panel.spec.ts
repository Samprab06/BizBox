import type { Page, Route } from "@playwright/test";
import { expect, expectNoA11yViolations, test } from "./fixtures";

// HAC-35: the consultant panel on the comparison screen follows an investigation job
// (GET /api/investigations/[id], POST .../advance) using the real { job, milestones } shape.

const ID = "inv-e2e";
type Status = "queued" | "running" | "succeeded" | "failed" | "interrupted";

function payload(
  status: Status,
  tools: string[],
  extra: { findings?: string[]; reason?: string | null } = {},
) {
  return {
    job: {
      id: ID,
      projectId: "houston-coffee",
      profileId: "profile-1",
      question: "Where should this coffee shop open?",
      status,
      attempt: 1,
      findings: extra.findings ?? [],
      reason: extra.reason ?? null,
    },
    milestones: tools.map((tool, seq) => ({
      investigationId: ID,
      attempt: 1,
      seq,
      tool,
      inputHash: `h${seq}`,
      summary: {},
      createdAt: "2026-11-14T12:00:00.000Z",
    })),
  };
}

/** Serves a scripted sequence: GET returns the current state, each advance moves to the next one. */
async function mockInvestigation(
  page: Page,
  states: ReturnType<typeof payload>[],
) {
  let index = 0;
  const advances: (string | null)[] = [];
  await page.route(
    `**/api/investigations/${ID}/advance`,
    async (route: Route) => {
      advances.push(route.request().postData());
      const body = route.request().postData();
      if (body && JSON.parse(body).action === "retry")
        index = states.length - 1;
      else index = Math.min(index + 1, states.length - 1);
      await route.fulfill({ json: states[index] });
    },
  );
  await page.route(`**/api/investigations/${ID}`, (route: Route) =>
    route.fulfill({ json: states[index] }),
  );
  return { advances };
}

const steps = (page: Page) =>
  page.getByRole("list", { name: "Investigation steps" }).getByRole("listitem");

test.describe("consultant panel", () => {
  test("starts a queued job, shows milestones in order and stops advancing once done", async ({
    page,
  }) => {
    const { advances } = await mockInvestigation(page, [
      payload("queued", []),
      payload("running", ["save_profile", "search_sites"]),
      payload("running", [
        "save_profile",
        "search_sites",
        "get_catchment",
        "evaluate_sites",
      ]),
      payload(
        "succeeded",
        [
          "save_profile",
          "search_sites",
          "get_catchment",
          "evaluate_sites",
          "finish_investigation",
        ],
        {
          findings: ["Demographics are partly default."],
        },
      ),
    ]);
    await page.goto(`/projects/houston-coffee/comparison?investigation=${ID}`);

    const panel = page.getByRole("region", { name: "Consultant activity" });
    await expect(panel.getByRole("status")).toHaveText("Done", {
      timeout: 20_000,
    });
    await expect(steps(page)).toHaveText([
      "Saved the founder profile",
      "Searched for-lease spaces",
      "Reviewed a catchment",
      "Evaluated the shortlist",
      "Finished the investigation",
    ]);
    await expect(panel.getByRole("list", { name: "Findings" })).toContainText(
      "Demographics are partly default.",
    );
    const count = advances.length;
    expect(count).toBe(3);
    await page.waitForTimeout(3500);
    expect(advances.length).toBe(count);
  });

  test("a failed job shows its reason and retries", async ({ page }) => {
    const { advances } = await mockInvestigation(page, [
      payload("failed", ["save_profile"], {
        reason: "Investigation time limit reached",
      }),
      payload("succeeded", ["save_profile", "finish_investigation"]),
    ]);
    await page.goto(`/projects/houston-coffee/comparison?investigation=${ID}`);

    const panel = page.getByRole("region", { name: "Consultant activity" });
    await expect(panel.getByRole("status")).toHaveText("Failed");
    await expect(panel.getByRole("alert")).toHaveText(
      "Investigation time limit reached",
    );
    expect(advances).toHaveLength(0);
    await panel.getByRole("button", { name: "Retry investigation" }).click();
    await expect(panel.getByRole("status")).toHaveText("Done");
    expect(JSON.parse(advances[0]!)).toEqual({ action: "retry" });
  });

  test("an unavailable status endpoint says so", async ({ page }) => {
    await page.route(`**/api/investigations/${ID}`, (route) =>
      route.fulfill({ status: 503, json: {} }),
    );
    await page.goto(`/projects/houston-coffee/comparison?investigation=${ID}`);
    await expect(
      page
        .getByRole("region", { name: "Consultant activity" })
        .getByRole("status"),
    ).toHaveText("Investigation update unavailable. Retrying.");
  });

  test("has no serious or critical accessibility violations", async ({
    page,
  }) => {
    await mockInvestigation(page, [
      payload("succeeded", ["save_profile", "finish_investigation"]),
    ]);
    await page.goto(`/projects/houston-coffee/comparison?investigation=${ID}`);
    await expect(
      page
        .getByRole("region", { name: "Consultant activity" })
        .getByRole("status"),
    ).toHaveText("Done");
    await expectNoA11yViolations(page);
  });
});
