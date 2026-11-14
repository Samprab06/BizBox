import type { Page } from "@playwright/test";
import { expect, expectNoA11yViolations, test } from "./fixtures";
import {
  liveComparisonId,
  liveComparisonPayload,
  mockLiveComparison,
} from "./live-comparison-fixtures";
import type { NessieCashFlowResponse } from "../../lib/contracts/nessie";

const path = "/projects/houston-coffee/comparison";
const accounts: NessieCashFlowResponse["accounts"] = [
  {
    id: "acct_demo_a",
    nickname: "Demo checking",
    type: "Checking",
    balanceCents: 120_000,
    availableCents: 100_000,
  },
  {
    id: "acct_demo_b",
    nickname: "Demo savings",
    type: "Savings",
    balanceCents: 450_000,
    availableCents: 450_000,
  },
];
function payload(accountId = ""): NessieCashFlowResponse {
  return {
    status: "ready",
    source: "nessie",
    synthetic: true,
    accounts,
    message: "Simulated banking",
    snapshot: accountId
      ? {
          accountId,
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
        }
      : null,
  };
}
const panel = (page: Page) =>
  page.getByRole("region", { name: "Cash buffer", exact: true });
const dollars = (value: number) =>
  value.toLocaleString("en-US", { style: "currency", currency: "USD" });

test("unconfigured and empty sandboxes remain honest and do not invent an account", async ({
  page,
}) => {
  await page.route("**/api/integrations/nessie*", (route) =>
    route.fulfill({
      json: {
        status: "unconfigured",
        source: "nessie",
        synthetic: true,
        accounts: [],
        snapshot: null,
        message: "Nessie is not configured yet.",
      },
    }),
  );
  await page.goto(path);
  await expect(panel(page)).toContainText("Nessie is not configured yet.");
  await expect(panel(page).getByLabel("Simulated cash account")).toHaveCount(0);
  await page.route("**/api/integrations/nessie*", (route) =>
    route.fulfill({
      json: {
        status: "empty",
        source: "nessie",
        synthetic: true,
        accounts: [],
        snapshot: null,
        message: "No simulated cash accounts are available.",
      },
    }),
  );
  await panel(page).getByRole("button", { name: "Refresh sandbox" }).click();
  await expect(panel(page)).toContainText(
    "No simulated cash accounts are available.",
  );
  await expect(
    panel(page).getByRole("term", { name: "Available cash" }),
  ).toHaveCount(0);
});

test("provider errors offer safe v2 setup and retry without displaying upstream details", async ({
  page,
}) => {
  await page.route("**/api/integrations/nessie*", (route) =>
    route.fulfill({
      status: 502,
      json: { message: "private upstream detail must not render" },
    }),
  );
  await page.goto(path);
  await expect(panel(page).getByRole("alert")).toContainText(
    "Check the Nessie v2 setup",
  );
  await expect(panel(page)).not.toContainText("private upstream detail");
  await expect(
    panel(page).getByRole("link", { name: "Review Nessie v2 setup" }),
  ).toHaveAttribute("href", "https://v2.nessieisreal.com/account");
  await page.route("**/api/integrations/nessie*", (route) =>
    route.fulfill({ json: payload() }),
  );
  await panel(page).getByRole("button", { name: "Retry Nessie" }).click();
  await expect(panel(page).getByLabel("Simulated cash account")).toBeEnabled();
});

test("account switch clears the old snapshot, and refresh removes deleted accounts", async ({
  page,
}) => {
  let removed = false;
  await page.route("**/api/integrations/nessie*", (route) => {
    const accountId =
      new URL(route.request().url()).searchParams.get("accountId") ?? "";
    const response = payload(accountId);
    if (removed) response.accounts = [accounts[1]];
    return route.fulfill({ json: response });
  });
  await page.goto(path);
  const select = panel(page).getByLabel("Simulated cash account");
  await expect(select).toHaveValue("");
  await select.selectOption(accounts[0].id);
  await expect(
    panel(page).getByRole("definition").filter({ hasText: "$1,000.00" }),
  ).toBeVisible();
  await select.selectOption(accounts[1].id);
  await expect(
    panel(page).getByRole("definition").filter({ hasText: "$4,500.00" }),
  ).toBeVisible();
  await expect(
    panel(page).getByRole("definition").filter({ hasText: "$1,000.00" }),
  ).toHaveCount(0);
  removed = true;
  await panel(page).getByRole("button", { name: "Refresh sandbox" }).click();
  await expect(select).toHaveValue("");
  await expect(select.locator("option")).toHaveCount(2);
  await expect(
    panel(page).getByRole("term", { name: "Available cash" }),
  ).toHaveCount(0);
  await select.selectOption(accounts[1].id);
  await expect(
    panel(page).getByRole("definition").filter({ hasText: "$4,500.00" }),
  ).toBeVisible();
  await expect(panel(page)).toContainText("Run a current site comparison");
});

test("a delayed account response cannot overwrite the selection after refresh", async ({
  page,
}) => {
  let release!: () => void;
  let requested!: () => void;
  const started = new Promise<void>((resolve) => {
    requested = resolve;
  });
  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });
  await page.route("**/api/integrations/nessie*", async (route) => {
    const accountId =
      new URL(route.request().url()).searchParams.get("accountId") ?? "";
    if (accountId === accounts[0].id) {
      requested();
      await gate;
    }
    await route.fulfill({ json: payload(accountId) }).catch(() => {});
  });
  await page.goto(path);
  const select = panel(page).getByLabel("Simulated cash account");
  await select.selectOption(accounts[0].id);
  await started;
  await panel(page).getByRole("button", { name: "Refresh sandbox" }).click();
  await expect(select).toBeEnabled();
  await select.selectOption(accounts[1].id);
  await expect(
    panel(page).getByRole("definition").filter({ hasText: "$4,500.00" }),
  ).toBeVisible();
  release();
  await expect(select).toHaveValue(accounts[1].id);
  await expect(
    panel(page).getByRole("definition").filter({ hasText: "$1,000.00" }),
  ).toHaveCount(0);
});

test("current site results change the cash buffer once and stay usable on narrow screens", async ({
  page,
}) => {
  await mockLiveComparison(page);
  await page.route("**/api/integrations/nessie*", (route) =>
    route.fulfill({
      json: payload(
        new URL(route.request().url()).searchParams.get("accountId") ?? "",
      ),
    }),
  );
  await page.goto(path);
  await page
    .getByRole("button", { name: "Run comparison", exact: true })
    .click();
  await panel(page)
    .getByLabel("Simulated cash account")
    .selectOption(accounts[0].id);
  const site = liveComparisonPayload.result.sites[0];
  await panel(page).getByLabel("Site scenario").selectOption(site.siteId);
  await panel(page).getByLabel("Upfront cost ($)").fill("100.99");
  const expected = dollars(
    (100_000 - 10_099 + Math.round(site.monthlyContributionUsd.mean * 100)) /
      100,
  );
  await expect(panel(page)).toContainText(
    `Modeled cash after one month: ${expected}`,
  );
  await expect(panel(page)).toContainText("upcoming bills are context only");
  await panel(page).getByLabel("Upfront cost ($)").fill("-5");
  await expect(panel(page).getByRole("alert")).toContainText("nonnegative");
  await expect(
    panel(page).getByText(/Modeled cash after one month:/),
  ).toHaveCount(0);
  await panel(page).getByLabel("Upfront cost ($)").fill("0");
  await expectNoA11yViolations(page);
  for (const width of [390, 768, 1440]) {
    await page.setViewportSize({ width, height: 900 });
    await expect(panel(page).getByLabel("Upfront cost ($)")).toBeVisible();
    expect(
      await panel(page).evaluate(
        (element) => element.scrollWidth <= element.clientWidth + 1,
      ),
    ).toBe(true);
  }
});

test("outdated comparison results never produce a cash projection", async ({
  page,
}) => {
  await mockLiveComparison(page, { outdated: true });
  await page.route("**/api/integrations/nessie*", (route) =>
    route.fulfill({
      json: payload(
        new URL(route.request().url()).searchParams.get("accountId") ?? "",
      ),
    }),
  );
  await page.goto(`${path}?comparison=${liveComparisonId}`);
  await panel(page)
    .getByLabel("Simulated cash account")
    .selectOption(accounts[0].id);
  await expect(panel(page)).toContainText(
    "Rerun the comparison before projecting cash",
  );
  await expect(panel(page).getByLabel("Site scenario")).toHaveCount(0);
  await expect(
    panel(page).getByText(/Modeled cash after one month:/),
  ).toHaveCount(0);
});
