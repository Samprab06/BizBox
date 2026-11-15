import type { Page } from "@playwright/test";
import { expect, expectNoA11yViolations, test } from "./fixtures";
import {
  mockLiveComparison,
  liveComparisonSearch,
  liveComparisonPayload,
  liveComparisonId,
  comparisonForCandidates,
} from "./live-comparison-fixtures";

// Invented API test responses exercise the production source branches. These are not
// vendor data or evidence that live inventory, imagery, scans or Jev were verified.
async function services(page: Page) {
  await mockLiveComparison(page);
  const search = structuredClone(liveComparisonSearch);
  for (const entry of search.candidates) entry.candidate.synthetic = false;
  await page.route("**/api/sites", (r) => r.fulfill({ json: search }));
  await page.route("**/api/projects/*/intake", (r) =>
    r.fulfill({ json: { modelConfigured: false } }),
  );
  await page.route("**/api/voice/session", (r) =>
    r.fulfill({ json: { configured: false } }),
  );
  const posts: string[][] = [];
  await page.route("**/api/comparisons", (r) => {
    const ids = r.request().postDataJSON().candidateIds as string[];
    posts.push(ids);
    const result = comparisonForCandidates(ids);
    result.comparison.synthetic = false;
    return r.fulfill({ status: 201, json: result });
  });
  await page.route(`**/api/comparisons/${liveComparisonId}?*`, (r) =>
    r.fulfill({
      json: {
        ...liveComparisonPayload,
        comparison: { ...liveComparisonPayload.comparison, synthetic: false },
      },
    }),
  );
  await page.route("**/api/sites/*/interior", (r) =>
    r.fulfill({
      json: {
        kind: "modeled",
        provenance: {
          origin: "default",
          provider: "modeled",
          mode: "live",
          scope: "space",
          description: "No verified scan exists for this selected suite.",
          limitations: [],
        },
      },
    }),
  );
  return { posts, search };
}

for (const viewport of [
  { width: 1366, height: 900 },
  { width: 820, height: 1180 },
  { width: 390, height: 844 },
]) {
  test.describe(`client flow ${viewport.width}`, () => {
    test.use({ viewport });
    test("real-source selection, explicit comparison and interior keep the same conversation", async ({
      page,
    }) => {
      const { posts } = await services(page);
      await page.goto("/projects/houston-coffee/workspace");
      const locations = page.getByRole("group", { name: "Matching locations" });
      await expect(
        locations.getByRole("button", { name: "View 101 Invented St" }),
      ).toBeVisible();
      await expect(
        page.getByRole("region", { name: "Selected location" }),
      ).toContainText("101 Invented St");
      await expect(
        page.getByText("City preview · photo, not a map"),
      ).toHaveCount(0);
      expect(posts).toHaveLength(0);
      const composer = page.getByRole("textbox", {
        name: "Message the BizBox assistant",
      });
      await composer.fill("Keep this question while I explore");
      await locations
        .getByRole("button", { name: "View 202 Invented St" })
        .click();
      await expect(page).toHaveURL(/site=202%3A302/);
      await expect(
        page.getByRole("region", { name: "Selected location" }),
      ).toContainText("202 Invented St");
      await page
        .getByRole("button", { name: "View interior", exact: true })
        .click();
      await expect(
        page.getByRole("heading", {
          name: "Interior unavailable",
          exact: true,
        }),
      ).toBeVisible();
      await expect(composer).toHaveValue("Keep this question while I explore");
      await page.getByRole("tab", { name: "Voice", exact: true }).click();
      await expect(
        page.getByRole("region", { name: "Voice assistant" }),
      ).toBeVisible();
      await expect(
        page.getByRole("button", { name: "Start voice", exact: true }),
      ).toBeDisabled();
      await page.getByRole("tab", { name: "Text", exact: true }).click();
      await expect(composer).toHaveValue("Keep this question while I explore");
      await page
        .getByRole("button", { name: "Locations", exact: true })
        .click();
      await page
        .getByRole("button", { name: "Compare locations", exact: true })
        .click();
      await expect(
        page.getByRole("region", { name: "Location comparison results" }),
      ).toBeVisible();
      expect(posts).toEqual([["201:301", "202:302"]]);
      await page
        .getByRole("region", { name: "Location comparison results" })
        .getByText("Details", { exact: true })
        .click();
      await expect(
        page.getByText("Modeled estimates · Huff fallback.", { exact: false }),
      ).toBeVisible();
      await expect(
        page.getByRole("button", { name: /Run baseline/ }),
      ).toHaveCount(0);
      await locations
        .getByRole("checkbox", { name: "Compare 202 Invented St" })
        .uncheck();
      await expect(
        page.getByRole("region", { name: "Location comparison results" }),
      ).toHaveCount(0);
      await expect(
        page.getByRole("button", { name: "Compare locations", exact: true }),
      ).toBeDisabled();
      await expect(composer).toHaveValue("Keep this question while I explore");
      expect(
        await page.evaluate(
          () => document.documentElement.scrollWidth <= innerWidth,
        ),
      ).toBe(true);
      await expectNoA11yViolations(page);
    });
  });
}

test("only a matching non-demo registry scan can mount the Matterport view", async ({
  page,
}) => {
  await services(page);
  await page.route("https://my.matterport.com/**", (r) =>
    r.fulfill({
      contentType: "text/html",
      body: "<!doctype html><title>Mocked viewer</title><p>Test viewer boundary</p>",
    }),
  );
  await page.route("**/api/sites/*/interior", (r) =>
    r.fulfill({
      json: {
        kind: "scan",
        modelId: "TestScan001",
        provenance: {
          origin: "matterport",
          provider: "matterport",
          mode: "live",
          scope: "space",
          description: "Matched test registry entry.",
          limitations: [],
        },
      },
    }),
  );
  await page.goto("/projects/houston-coffee/workspace");
  await expect(
    page.getByRole("button", { name: "View interior", exact: true }),
  ).toBeVisible();
  await page
    .getByRole("button", { name: "View interior", exact: true })
    .click();
  await expect(
    page.locator('iframe[title="Matterport interior for 101 Invented St"]'),
  ).toHaveAttribute("src", /my\.matterport\.com\/show\/\?m=TestScan001/);
  await expect(
    page.getByText("Interior details", { exact: true }),
  ).toBeVisible();
});

test("unavailable inventory never substitutes example properties", async ({
  page,
}) => {
  await services(page);
  await page.route("**/api/sites", (r) => r.fulfill({ status: 503, json: {} }));
  await page.goto("/projects/houston-coffee/workspace");
  await expect(
    page.getByText("Listings unavailable", { exact: true }),
  ).toBeVisible();
  await expect(
    page.getByRole("group", { name: "Matching locations" }),
  ).toHaveCount(0);
  await expect(
    page.getByRole("button", { name: "Compare locations", exact: true }),
  ).toBeDisabled();
  await expect(
    page.getByText("Montrose storefront", { exact: true }),
  ).toHaveCount(0);
});

// Desktop-only readiness regression. All founder answers and API payloads below are
// explicitly invented fixtures; no saved personal answers or provider calls are used.
const inventedBrief = (city = "Houston") => ({
  profile: Object.fromEntries(
    Object.entries({
      concept: "Test coffee concept",
      category: "Coffee shop",
      city,
      areas: "Favor west side; avoid malls",
      rent: "4500",
      buildout: "80000",
      price: "Midrange",
      customers: "Commuters",
      hours: "7am–5pm",
      staff: "2",
      requirements: "None",
    }).map(([key, value]) => [key, { value, origin: "founder" }]),
  ),
  messages: [],
});
async function readinessServices(
  page: Page,
  brief?: ReturnType<typeof inventedBrief>,
) {
  await page.route("**/api/projects/*/intake", (r) =>
    r.fulfill({ json: { modelConfigured: false } }),
  );
  await page.route("**/api/voice/session", (r) =>
    r.fulfill({ json: { configured: false } }),
  );
  await page.route("**/api/comparisons/capabilities", (r) =>
    r.fulfill({ json: { jevConfigured: false } }),
  );
  if (brief)
    await page.addInitScript(
      (value) =>
        localStorage.setItem(
          "sitework:intake:v1:houston-coffee",
          JSON.stringify(value),
        ),
      brief,
    );
  const search = structuredClone(liveComparisonSearch);
  for (const entry of search.candidates) entry.candidate.synthetic = false;
  return search;
}

test.describe("inventory readiness desktop", () => {
  test.use({ viewport: { width: 1366, height: 900 } });
  test("missing or unsupported brief never requests inventory and offers the brief action", async ({
    page,
  }) => {
    await readinessServices(page);
    let requests = 0;
    await page.route("**/api/sites", (r) => {
      requests++;
      return r.fulfill({ status: 503, json: {} });
    });
    await page.goto("/projects/houston-coffee/workspace");
    await expect(
      page.getByText("Complete your brief", { exact: true }),
    ).toBeVisible();
    await expect(
      page.getByRole("link", { name: "Finish brief", exact: true }),
    ).toHaveAttribute("href", /\/intake$/);
    expect(requests).toBe(0);
    await page.evaluate((brief) => {
      const key = "sitework:intake:v1:houston-coffee";
      localStorage.setItem(key, JSON.stringify(brief));
      window.dispatchEvent(
        new CustomEvent("sitework:intake-updated", { detail: { key } }),
      );
    }, inventedBrief("New York"));
    await expect(
      page.getByText("Complete your brief", { exact: true }),
    ).toBeVisible();
    expect(requests).toBe(0);
  });

  test("service failure offers Retry and does not pretend there are no matches", async ({
    page,
  }) => {
    const search = await readinessServices(page, inventedBrief());
    let requests = 0;
    await page.route("**/api/sites", (r) => {
      requests++;
      return requests === 1
        ? r.fulfill({ status: 503, json: {} })
        : r.fulfill({ json: search });
    });
    await page.goto("/projects/houston-coffee/workspace");
    await expect(
      page.getByText("Listings unavailable", { exact: true }),
    ).toBeVisible();
    await expect(
      page.getByText("No matching spaces", { exact: true }),
    ).toHaveCount(0);
    await page
      .getByRole("region", { name: "Location and interior workspace" })
      .getByRole("button", { name: "Retry", exact: true })
      .click();
    await expect(
      page.getByRole("group", { name: "Matching locations" }),
    ).toBeVisible();
    expect(requests).toBe(2);
  });

  test("a successful empty result offers Revise criteria and keeps filter reasons in Details", async ({
    page,
  }) => {
    const search = await readinessServices(page, inventedBrief());
    const emptyReason = "No sites remain; most restrictive filter: rentCeiling";
    await page.route("**/api/sites", (r) =>
      r.fulfill({
        json: {
          ...search,
          candidates: [],
          totalMatched: 0,
          emptyReason,
          mostRestrictiveFilter: "rentCeiling",
          filters: [{ name: "rentCeiling", before: 3, removed: 3, after: 0 }],
        },
      }),
    );
    await page.goto("/projects/houston-coffee/workspace");
    await expect(
      page.getByText("No matching spaces", { exact: true }),
    ).toBeVisible();
    await expect(
      page.getByRole("link", { name: "Revise criteria", exact: true }),
    ).toHaveAttribute("href", /\/intake$/);
    await expect(
      page.getByText(emptyReason, { exact: true }),
    ).not.toBeVisible();
    await page
      .getByRole("region", { name: "Location and interior workspace" })
      .getByText("Details", { exact: true })
      .click();
    await expect(page.getByText(emptyReason, { exact: true })).toBeVisible();
    await expect(
      page.getByText("Largest reduction: Rent limit", { exact: true }),
    ).toBeVisible();
  });

  test("same-tab criteria edits refetch exact criteria while chat-only saves do not", async ({
    page,
  }) => {
    const search = await readinessServices(page, inventedBrief());
    const requests: {
      profile: { economics: { monthlyRentCeilingCents: { value: number } } };
      limit: number;
    }[] = [];
    await page.route("**/api/sites", (r) => {
      requests.push(r.request().postDataJSON());
      return r.fulfill({
        json:
          requests.length >= 3
            ? { ...search, candidates: [search.candidates[0]], totalMatched: 1 }
            : search,
      });
    });
    await page.goto("/projects/houston-coffee/workspace");
    const locations = page.getByRole("group", { name: "Matching locations" });
    await locations
      .getByRole("button", { name: "View 202 Invented St", exact: true })
      .click();
    await page
      .getByRole("textbox", { name: "Message the BizBox assistant" })
      .fill("Retain this draft");
    await page.evaluate(() => {
      const key = "sitework:intake:v1:houston-coffee",
        session = JSON.parse(localStorage.getItem(key)!);
      session.messages.push({
        role: "agent",
        text: "Conversation-only update",
      });
      localStorage.setItem(key, JSON.stringify(session));
      window.dispatchEvent(
        new CustomEvent("sitework:intake-updated", { detail: { key } }),
      );
    });
    await expect(page.getByRole("log", { name: "Conversation" })).toContainText(
      "Conversation-only update",
    );
    expect(requests).toHaveLength(1);
    await page.evaluate(() => {
      const key = "sitework:intake:v1:houston-coffee",
        session = JSON.parse(localStorage.getItem(key)!);
      session.profile.rent.value = "3000";
      localStorage.setItem(key, JSON.stringify(session));
      window.dispatchEvent(
        new CustomEvent("sitework:intake-updated", { detail: { key } }),
      );
    });
    await expect.poll(() => requests.length).toBe(2);
    expect(
      requests.map((r) => r.profile.economics.monthlyRentCeilingCents.value),
    ).toEqual([450000, 300000]);
    expect(
      requests.every(
        (r) =>
          r.limit === 8 && Object.keys(r).sort().join(",") === "limit,profile",
      ),
    ).toBe(true);
    await expect(
      page.getByRole("region", { name: "Selected location" }),
    ).toContainText("202 Invented St");
    await expect(page).toHaveURL(/site=202%3A302/);
    await expect(
      page.getByRole("textbox", { name: "Message the BizBox assistant" }),
    ).toHaveValue("Retain this draft");
    // A later response can exclude the chosen listing; never retain its stale URL.
    await page.evaluate(() => {
      const key = "sitework:intake:v1:houston-coffee";
      const session = JSON.parse(localStorage.getItem(key)!);
      session.profile.rent.value = "2500";
      localStorage.setItem(key, JSON.stringify(session));
      window.dispatchEvent(
        new CustomEvent("sitework:intake-updated", { detail: { key } }),
      );
    });
    await expect.poll(() => requests.length).toBe(3);
    await expect(
      page.getByRole("region", { name: "Selected location" }),
    ).toContainText("101 Invented St");
    await expect(page).toHaveURL(/site=201%3A301/);
    await expect(
      locations.getByRole("button", {
        name: "View 202 Invented St",
        exact: true,
      }),
    ).toHaveCount(0);
    await expect(
      page.getByRole("textbox", { name: "Message the BizBox assistant" }),
    ).toHaveValue("Retain this draft");
    await expectNoA11yViolations(page);
  });
});
