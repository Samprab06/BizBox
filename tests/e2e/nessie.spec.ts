import type { Page } from "@playwright/test";
import { expect, expectNoA11yViolations, test } from "./fixtures";
import {
  liveComparisonId,
  liveComparisonPayload,
  mockLiveComparison,
} from "./live-comparison-fixtures";
import type { NessieConsultantResult } from "../../lib/contracts/nessie";

const PROJECT = "houston-coffee";
const ID = "inv-nessie";
const path = "/projects/houston-coffee/comparison";
const account = {
  id: "acct_demo",
  nickname: "Consultant demo checking",
  type: "Checking" as const,
  balanceCents: 100_000,
  availableCents: 80_000,
};
const panel = (page: Page) =>
  page.getByRole("region", { name: "Consultant activity", exact: true });
const card = (page: Page) =>
  panel(page).getByRole("region", {
    name: "Saved Nessie cash assessment",
    exact: true,
  });
function cashResult(
  change: Partial<NessieConsultantResult> = {},
): NessieConsultantResult {
  return {
    kind: "nessie_cash_buffer",
    source: "nessie",
    synthetic: true,
    investigationId: ID,
    projectId: PROJECT,
    attempt: 2,
    profileId: "profile-live-57",
    profileVersion: 1,
    status: "ready",
    message:
      "The only simulated cash account was selected for this assessment.",
    accounts: [account],
    selectedAccount: account,
    snapshot: {
      accountId: account.id,
      asOf: "2026-11-14T16:00:00Z",
      windowStart: "2026-10-15T16:00:00Z",
      windowEnd: "2026-11-14T16:00:00Z",
      windowDays: 30,
      inflowCents: 40_000,
      outflowCents: 60_000,
      netCashFlowCents: -20_000,
      completedTransactionCount: 8,
      excludedTransfersCount: 2,
      upcomingBillsCents: 15_000,
    },
    scenario: null,
    ...change,
  };
}
function milestone(
  output: unknown,
  seq = 2,
  tool = "read_nessie_cash_buffer",
  attempt = 2,
  investigationId = ID,
) {
  return { investigationId, attempt, seq, tool, summary: { output } };
}
function investigation(
  milestones: unknown[] = [milestone(cashResult())],
  id = ID,
  status = "succeeded",
  attempt = 2,
) {
  return {
    job: {
      id,
      projectId: PROJECT,
      profileId: "profile-live-57",
      attempt,
      status,
      findings: [] as string[],
      reason: null,
    },
    milestones,
  };
}
async function serve(page: Page, response: unknown) {
  await page.route(`**/api/investigations/${ID}`, (route) =>
    route.fulfill({ json: response }),
  );
}

test.beforeEach(async ({ page }) => {
  await page.route("**/api/integrations/nessie*", () => {
    throw new Error(
      "Consultant evidence must never fetch the banking endpoint from the browser",
    );
  });
});

test("saved cash evidence appears after the consultant step without a banking form or direct banking request", async ({
  page,
}) => {
  const requested: string[] = [];
  page.on("request", (request) => {
    if (request.url().includes("nessie")) requested.push(request.url());
  });
  await serve(page, investigation());
  await page.goto(`${path}?investigation=${ID}`);
  await expect(panel(page)).toHaveCount(1);
  await expect(
    panel(page).getByRole("list", { name: "Investigation steps" }),
  ).toContainText("Assessed the simulated cash buffer");
  await expect(card(page)).toContainText("Consultant demo checking");
  await expect(
    card(page).getByRole("definition").filter({ hasText: "$800.00" }),
  ).toBeVisible();
  await expect(card(page)).toContainText("$400.00");
  await expect(card(page)).toContainText("$600.00");
  await expect(card(page)).toContainText("-$200.00");
  await expect(card(page)).toContainText("$150.00");
  await expect(card(page)).toContainText("Simulation");
  await expect(card(page)).toContainText("Cash evidence only");
  await expect(
    page.getByRole("heading", { name: "Cash buffer", exact: true }),
  ).toHaveCount(0);
  await expect(page.getByLabel("Simulated cash account")).toHaveCount(0);
  await expect(page.getByLabel("Upfront cost ($)")).toHaveCount(0);
  expect(
    requested.filter((url) =>
      /api\/integrations\/nessie|v2-prod-api\.nessieisreal/.test(url),
    ),
  ).toEqual([]);
});

test("investigation-owned scenario renders server-derived buildout and cash even on a fixture comparison", async ({
  page,
}) => {
  const result = cashResult({
    scenario: {
      comparisonId: "consultant-owned-comparison",
      siteId: "201:301",
      modeledUpfrontBuildoutCents: 20_000,
      monthlyContributionUsd: { low: -200, mean: -100, high: 50 },
      projection: {
        cashAfterOneMonthCents: { low: 40_000, mean: 50_000, high: 65_000 },
        coverage: { kind: "burning", months: 6 },
      },
    },
  });
  await serve(
    page,
    investigation([
      milestone(
        {
          profileId: result.profileId,
          comparisonId: "consultant-owned-comparison",
          siteIds: ["201:301"],
        },
        1,
        "evaluate_sites",
      ),
      milestone(result),
    ]),
  );
  await page.goto(`${path}?investigation=${ID}`);
  await expect(card(page)).toContainText("consultant-owned-comparison");
  await expect(card(page)).toContainText("Assessed site: 201:301");
  await expect(card(page)).toContainText("Modeled upfront buildout");
  await expect(card(page)).toContainText("$200.00");
  await expect(card(page)).toContainText("$500.00");
  await expect(card(page)).toContainText("$400.00 to $650.00");
  await expect(card(page)).toContainText("6 months");
  await expect(card(page)).toContainText("scenario, not a forecast");
  await expectNoA11yViolations(page);
  for (const width of [390, 768, 1440]) {
    await page.setViewportSize({ width, height: 900 });
    expect(
      await card(page).evaluate(
        (element) => element.scrollWidth <= element.clientWidth + 1,
      ),
    ).toBe(true);
  }
});

test("empty, unavailable and multiple-account findings are inline saved limitations with no invented cash", async ({
  page,
}) => {
  const other = {
    ...account,
    id: "acct_other",
    nickname: "Demo savings",
    type: "Savings" as const,
  };
  const statuses: Array<NessieConsultantResult["status"]> = [
    "unconfigured",
    "empty",
    "provider_error",
    "account_selection_required",
    "account_not_found",
    "comparison_unavailable",
  ];
  for (const status of statuses) {
    await serve(
      page,
      investigation([
        milestone(
          cashResult({
            status,
            message: `Saved limitation: ${status}`,
            accounts:
              status === "account_selection_required" ||
              status === "account_not_found"
                ? [account, other]
                : [],
            selectedAccount: null,
            snapshot: null,
          }),
        ),
      ]),
    );
    await page.goto(`${path}?investigation=${ID}`);
    await expect(card(page)).toContainText(`Saved limitation: ${status}`);
    await expect(
      card(page).getByRole("term", { name: "Available cash", exact: true }),
    ).toHaveCount(0);
    if (
      status === "account_selection_required" ||
      status === "account_not_found"
    ) {
      await expect(
        card(page).getByRole("list", { name: "Available demo accounts" }),
      ).toContainText("Demo savings");
      await expect(card(page)).toContainText("Which demo account");
    }
  }
});

test("old attempts, wrong identity and malformed saved JSON never render financial cards", async ({
  page,
}) => {
  const invalid: unknown[] = [
    milestone(cashResult({ attempt: 1 }), 0, "read_nessie_cash_buffer", 1),
    milestone(cashResult({ projectId: "other-project" }), 1),
    milestone(cashResult({ profileId: "foreign-profile" }), 2),
    milestone(cashResult({ investigationId: "other-investigation" }), 3),
    milestone(JSON.stringify(cashResult()), 4),
    milestone({ ...cashResult(), synthetic: false }, 5),
    milestone(
      {
        ...cashResult(),
        snapshot: { ...cashResult().snapshot, netCashFlowCents: 999 },
      },
      6,
    ),
    milestone(cashResult(), 7, "evaluate_sites"),
  ];
  await serve(page, investigation(invalid));
  await page.goto(`${path}?investigation=${ID}`);
  await expect(panel(page).getByRole("status")).toHaveText("Done");
  await expect(card(page)).toHaveCount(0);
});

test("a newer cash failure replaces older guidance, and malformed newest output never falls back", async ({
  page,
}) => {
  const unavailable = cashResult({
    status: "provider_error",
    message: "The latest cash read is unavailable.",
    selectedAccount: null,
    snapshot: null,
  });
  await serve(
    page,
    investigation([milestone(cashResult(), 1), milestone(unavailable, 2)]),
  );
  await page.goto(`${path}?investigation=${ID}`);
  await expect(card(page)).toHaveCount(1);
  await expect(card(page)).toContainText("latest cash read is unavailable");
  await expect(
    card(page).getByRole("term", { name: "Available cash", exact: true }),
  ).toHaveCount(0);
  await serve(
    page,
    investigation([
      milestone(cashResult(), 1),
      milestone({ malformed: true }, 2),
    ]),
  );
  await page.reload();
  await expect(panel(page).getByRole("status")).toHaveText("Done");
  await expect(card(page)).toHaveCount(0);
});

test("superseded cash notes disappear from accumulated findings while location notes remain", async ({
  page,
}) => {
  const oldAmount =
    "Nessie cash buffer has $800.00 available for the old site.";
  const oldQuestion =
    "Which demo account should we use, old checking or savings?";
  const modelCash = "The prior cash assessment can cover six months.";
  const preserved = "The location still needs a lease review.";
  const oldStep = {
    ...milestone(cashResult(), 1),
    summary: {
      output: cashResult(),
      toolFindings: [oldAmount, oldQuestion],
      modelFindings: [modelCash],
    },
  };
  const failed = cashResult({
    status: "provider_error",
    message: "Latest cash assessment is unavailable.",
    selectedAccount: null,
    snapshot: null,
  });
  const raw = investigation([oldStep, milestone(failed, 2)]);
  raw.job.findings = [oldAmount, oldQuestion, modelCash, preserved];
  await serve(page, raw);
  await page.goto(`${path}?investigation=${ID}`);
  await expect(card(page)).toContainText(
    "Latest cash assessment is unavailable",
  );
  await expect(panel(page)).not.toContainText(oldAmount);
  await expect(panel(page)).not.toContainText(oldQuestion);
  await expect(panel(page)).not.toContainText(modelCash);
  await expect(panel(page)).toContainText(preserved);
  await serve(page, {
    ...raw,
    milestones: [oldStep, milestone({ broken: true }, 2)],
  });
  await page.reload();
  await expect(panel(page).getByRole("status")).toHaveText("Done");
  await expect(card(page)).toHaveCount(0);
  await expect(panel(page)).not.toContainText(oldAmount);
  await serve(page, {
    ...raw,
    job: { ...raw.job, attempt: 3 },
    milestones: [
      oldStep,
      milestone({ ...failed, attempt: 3 }, 2, "read_nessie_cash_buffer", 3),
    ],
  });
  await page.reload();
  await expect(card(page)).toContainText(
    "Latest cash assessment is unavailable",
  );
  await expect(panel(page)).not.toContainText(oldAmount);
  await expect(panel(page)).not.toContainText(oldQuestion);
  await expect(panel(page)).toContainText(preserved);
});

test("matching old profile cash guidance is suppressed when the displayed comparison is outdated", async ({
  page,
}) => {
  await mockLiveComparison(page, { outdated: true });
  const result = cashResult({
    scenario: {
      comparisonId: liveComparisonId,
      siteId: "201:301",
      modeledUpfrontBuildoutCents: 20_000,
      monthlyContributionUsd: { low: -200, mean: -100, high: 50 },
      projection: {
        cashAfterOneMonthCents: { low: 40_000, mean: 50_000, high: 65_000 },
        coverage: { kind: "burning", months: 6 },
      },
    },
  });
  const oldNote = "The cash result has $800.00 and covers six months.";
  const step = {
    ...milestone(result, 2),
    summary: { output: result, toolFindings: [oldNote] },
  };
  const raw = investigation([
    milestone(
      {
        profileId: result.profileId,
        comparisonId: liveComparisonId,
        siteIds: ["201:301"],
      },
      1,
      "evaluate_sites",
    ),
    step,
  ]);
  raw.job.findings = [oldNote, "Candidate locations remain on the shortlist."];
  await serve(page, raw);
  await page.goto(`${path}?investigation=${ID}&comparison=${liveComparisonId}`);
  await expect(
    page.getByRole("table", { name: /Live comparison/ }),
  ).toBeVisible();
  await expect(panel(page)).toContainText(
    "Rerun the comparison before using saved cash guidance",
  );
  await expect(card(page)).toHaveCount(0);
  await expect(panel(page)).not.toContainText("$800.00");
  await expect(panel(page)).not.toContainText("six months");
  await expect(panel(page)).toContainText(
    "Candidate locations remain on the shortlist.",
  );
});

test("cash guidance is hidden while a new comparison is running", async ({
  page,
}) => {
  await mockLiveComparison(page);
  await serve(page, investigation());
  await page.goto(`${path}?investigation=${ID}&comparison=${liveComparisonId}`);
  await expect(
    page.getByRole("table", { name: /Live comparison/ }),
  ).toBeVisible();
  await expect(card(page)).toContainText("$800.00");
  let release!: () => void;
  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });
  await page.route("**/api/comparisons", async (route) => {
    await gate;
    await route.fulfill({ status: 201, json: liveComparisonPayload });
  });
  await page
    .getByRole("button", { name: "Run comparison", exact: true })
    .click();
  await expect(
    page.getByRole("button", { name: "Running comparison…", exact: true }),
  ).toBeVisible();
  await expect(card(page)).toHaveCount(0);
  await expect(panel(page)).toContainText(
    "Rerun the comparison before using saved cash guidance",
  );
  release();
  await expect(card(page)).toContainText("$800.00");
});

test("the consultant only shows cash after its queued step has completed and saved evidence", async ({
  page,
}) => {
  let release!: () => void;
  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });
  await serve(page, investigation([], ID, "queued"));
  await page.route(`**/api/investigations/${ID}/advance`, async (route) => {
    await gate;
    await route.fulfill({ json: investigation() });
  });
  await page.goto(`${path}?investigation=${ID}`);
  await expect(panel(page).getByRole("status")).toHaveText("Queued");
  await expect(card(page)).toHaveCount(0);
  release();
  await expect(card(page)).toContainText("Consultant demo checking");
});

test("latest consultant save_profile wins and live comparison activity receives its investigation context", async ({
  page,
}) => {
  await mockLiveComparison(page);
  const result = cashResult();
  await serve(page, {
    ...investigation([
      milestone(
        { profileId: result.profileId, profileVersion: 1 },
        0,
        "save_profile",
      ),
      milestone(result),
    ]),
    job: { ...investigation().job, profileId: "initial-profile" },
  });
  await page.goto(`${path}?investigation=${ID}&comparison=${liveComparisonId}`);
  await expect(
    page.getByRole("table", { name: /Live comparison/ }),
  ).toBeVisible();
  await expect(panel(page)).toHaveCount(1);
  await expect(card(page)).toContainText("Consultant demo checking");
  await serve(
    page,
    investigation([milestone(cashResult({ profileId: "stale-profile" }))]),
  );
  await page.reload();
  await expect(panel(page).getByRole("status")).toHaveText("Done");
  await expect(card(page)).toHaveCount(0);
});

test("a conflicting displayed live profile suppresses an otherwise valid consultant assessment", async ({
  page,
}) => {
  await mockLiveComparison(page);
  const changed = cashResult({
    profileId: "consultant-new-profile",
    profileVersion: 2,
  });
  await serve(
    page,
    investigation([
      milestone(
        { profileId: changed.profileId, profileVersion: 2 },
        0,
        "save_profile",
      ),
      milestone(changed),
    ]),
  );
  await page.goto(`${path}?investigation=${ID}&comparison=${liveComparisonId}`);
  await expect(
    page.getByRole("table", { name: /Live comparison/ }),
  ).toBeVisible();
  await expect(panel(page)).toContainText("current business profile differs");
  await expect(card(page)).toHaveCount(0);
});

test("switching investigations clears the saved card and a delayed old response cannot replace current findings", async ({
  page,
}) => {
  const nextId = "inv-next";
  let release!: () => void;
  let started!: () => void;
  const requested = new Promise<void>((resolve) => {
    started = resolve;
  });
  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });
  const states = investigation([], ID, "queued");
  await serve(page, states);
  await page.route(`**/api/investigations/${ID}/advance`, async (route) => {
    started();
    await gate;
    await route.fulfill({ json: investigation() }).catch(() => {});
  });
  await page.route(`**/api/investigations/${nextId}`, (route) =>
    route.fulfill({
      json: {
        ...investigation([], nextId),
        job: {
          ...investigation([], nextId).job,
          findings: ["Current investigation findings"],
        },
      },
    }),
  );
  await page.goto(`${path}?investigation=${ID}`);
  await requested;
  await page.goto(`${path}?investigation=${nextId}`);
  await expect(panel(page)).toContainText("Current investigation findings");
  release();
  await expect(card(page)).toHaveCount(0);
  await expect(panel(page)).toContainText("Current investigation findings");
});
