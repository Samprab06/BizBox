import { expect, expectNoA11yViolations, test } from "./fixtures";
import {
  liveCandidateIds,
  liveComparisonId,
  liveComparisonPayload,
  liveComparisonSearch,
  mockLiveComparison,
  comparisonForCandidates,
} from "./live-comparison-fixtures";

test("completed intake permits deselection and runs only after an explicit action", async ({
  page,
}) => {
  await mockLiveComparison(page);
  const posts: unknown[] = [];
  await page.route("**/api/comparisons", (route) => {
    posts.push(route.request().postDataJSON());
    return route.fulfill({
      status: 201,
      json: comparisonForCandidates(
        route.request().postDataJSON().candidateIds,
      ),
    });
  });
  await page.goto("/projects/houston-coffee/comparison");
  await expect(
    page.getByRole("checkbox", { name: /101 Invented St/ }),
  ).toBeChecked();
  await expect(
    page.getByRole("checkbox", { name: /202 Invented St/ }),
  ).toBeChecked();
  expect(posts).toEqual([]);
  await page.getByRole("checkbox", { name: /202 Invented St/ }).uncheck();
  await page.getByRole("checkbox", { name: /101 Invented St/ }).uncheck();
  await expect(
    page.getByRole("button", { name: "Run comparison", exact: true }),
  ).toBeDisabled();
  await page.getByRole("checkbox", { name: /101 Invented St/ }).check();
  await page
    .getByRole("button", { name: "Run comparison", exact: true })
    .click();
  await expect(
    page.getByRole("table", { name: /Live comparison/ }),
  ).toBeVisible();
  expect(posts).toHaveLength(1);
  expect(posts[0]).toMatchObject({
    projectId: "houston-coffee",
    profileId: "profile-live-57",
    candidateIds: [liveCandidateIds[0]],
    demandSource: "huff",
  });
  await expect(page.getByText("Example data", { exact: true })).toHaveCount(0);
});

test("live ranking keeps intervals, model provenance, findings and saved replay links", async ({
  page,
}) => {
  await mockLiveComparison(page);
  await page.goto("/projects/houston-coffee/comparison");
  await page
    .getByRole("button", { name: "Run comparison", exact: true })
    .click();
  const table = page.getByRole("table", { name: /Live comparison/ });
  await expect(table).toContainText("90% interval");
  await expect(table.getByRole("rowheader").first()).toContainText(
    "101 Invented St",
  );
  await expect(page.getByText(/Demographics partly default/)).toBeVisible();
  await expect(page.getByText(/Demand source: Huff/i)).toBeVisible();
  await expect(page.getByText(/Seeds: 11, 12, 13/)).toBeVisible();
  const scenario = page
    .getByRole("region", { name: /Operating ranges/ })
    .first();
  for (const label of [
    "Monthly revenue",
    "Served customers per month",
    "Weekday mean wait",
    "Weekday abandonment",
    "Weekday utilization",
  ]) {
    await expect(
      scenario.getByRole("term").filter({ hasText: label }),
    ).toBeVisible();
  }
  const values = scenario.getByRole("definition");
  for (const value of await values.all()) {
    await expect(value).toContainText(/ to /);
  }
  await expect(
    table.getByRole("link", { name: "Replay weekday" }).first(),
  ).toHaveAttribute("href", new RegExp(`comparison=${liveComparisonId}`));
  await page.reload();
  await expect(
    page.getByRole("table", { name: /Live comparison/ }),
  ).toBeVisible();
  await expectNoA11yViolations(page);
});

test("sensitivity runs the selected assumption and reports top-site change and break-even", async ({
  page,
}) => {
  await mockLiveComparison(page);
  await page.goto("/projects/houston-coffee/comparison");
  await page
    .getByRole("button", { name: "Run comparison", exact: true })
    .click();
  for (const [label, assumption] of [
    ["Rent ±10%", "rent"],
    ["Average ticket", "ticket_size"],
    ["Market share", "market_share_scale"],
    ["Price", "price"],
  ]) {
    await page.getByLabel("Sensitivity assumption").selectOption({ label });
    const request = page.waitForRequest(
      (r) => r.url().endsWith("/sensitivity") && r.method() === "POST",
    );
    await page
      .getByRole("button", { name: "Run sensitivity", exact: true })
      .click();
    expect((await request).postDataJSON()).toMatchObject({
      projectId: "houston-coffee",
      assumption,
    });
    await expect(
      page.getByRole("heading", { name: `${label} result`, exact: true }),
    ).toBeVisible();
    await expect(
      page.getByText("The top site changes within the tested range."),
    ).toBeVisible();
    await expect(page.getByText(/Break-even/).last()).toBeVisible();
  }
});

test("no intake and a failed API retain explicit examples with retry", async ({
  page,
}) => {
  await page.goto("/projects/houston-coffee/comparison");
  await expect(page.getByText("Example data", { exact: true })).toBeVisible();
  await expect(page.getByText(/Complete your intake/).first()).toBeVisible();
  await mockLiveComparison(page);
  await page.route("**/api/comparisons", (route) =>
    route.fulfill({
      status: 503,
      json: {
        code: "COMPARISON_UNAVAILABLE",
        message: "Comparison unavailable",
      },
    }),
  );
  await page.reload();
  await page
    .getByRole("button", { name: "Run comparison", exact: true })
    .click();
  await expect(
    page
      .getByRole("alert")
      .filter({ hasText: /could not be run|unavailable/i }),
  ).toContainText(/could not be run|unavailable/i);
  await expect(page.getByText("Example data", { exact: true })).toBeVisible();
});

test("empty live search stays empty without inventing a ranking", async ({
  page,
}) => {
  await mockLiveComparison(page);
  await page.route("**/api/sites", (route) =>
    route.fulfill({
      json: {
        ...liveComparisonSearch,
        candidates: [],
        totalMatched: 0,
        emptyReason: "No matching live sites",
      },
    }),
  );
  await page.goto("/projects/houston-coffee/comparison");
  await expect(page.getByText("No matching live sites")).toBeVisible();
  await expect(
    page.getByRole("button", { name: "Run comparison", exact: true }),
  ).toBeDisabled();
  await expect(page.getByText("Example data", { exact: true })).toHaveCount(0);
});

test("comparison retains the no-single-sales-forecast guard across widths and keyboard navigation", async ({
  page,
}) => {
  await mockLiveComparison(page);
  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.goto("/projects/houston-coffee/comparison");
  const run = page.getByRole("button", { name: "Run comparison", exact: true });
  await run.focus();
  await page.keyboard.press("Enter");
  await expect(
    page.getByRole("table", { name: /Live comparison/ }),
  ).toBeVisible();
  for (const width of [390, 820, 1280]) {
    await page.setViewportSize({ width, height: 900 });
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= window.innerWidth,
      ),
    ).toBe(true);
  }
  for (const value of await page
    .getByRole("region", { name: /Operating ranges/ })
    .getByRole("definition")
    .all()) {
    await expect(value).toContainText(/ to /);
  }
  await expectNoA11yViolations(page);
});

test("running comparison shows progress and locks selections until the saved result returns", async ({
  page,
}) => {
  await mockLiveComparison(page);
  let release!: () => void;
  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });
  await page.route("**/api/comparisons", async (route) => {
    await gate;
    await route.fulfill({ status: 201, json: liveComparisonPayload });
  });
  await page.goto("/projects/houston-coffee/comparison");
  await page
    .getByRole("button", { name: "Run comparison", exact: true })
    .click();
  await expect(
    page
      .getByRole("status")
      .filter({ hasText: /Evaluating seeded weekday and weekend scenarios/ }),
  ).toBeVisible();
  await expect(
    page.getByRole("checkbox", { name: /101 Invented St/ }),
  ).toBeDisabled();
  release();
  await expect(
    page.getByRole("table", { name: /Live comparison/ }),
  ).toBeVisible();
  await expect(
    page.getByRole("checkbox", { name: /101 Invented St/ }),
  ).toBeEnabled();
});

test("saved comparisons reload with an outdated badge and returned modeled ties", async ({
  page,
}) => {
  await mockLiveComparison(page, { outdated: true });
  const payload = structuredClone(liveComparisonPayload);
  payload.result.sites[0].tiedWith = [liveCandidateIds[1]];
  payload.result.sites[1].tiedWith = [liveCandidateIds[0]];
  await page.route("**/api/comparisons", (route) =>
    route.fulfill({ status: 201, json: payload }),
  );
  await page.goto("/projects/houston-coffee/comparison");
  await page
    .getByRole("button", { name: "Run comparison", exact: true })
    .click();
  await expect(
    page.getByText(/Modeled tie · overlapping intervals/),
  ).toHaveCount(2);
  await page.reload();
  await expect(
    page.getByRole("status").filter({ hasText: /comparison is outdated/ }),
  ).toBeVisible();
  await expect(
    page.getByRole("button", { name: "Rerun comparison", exact: true }),
  ).toBeVisible();
});

test("configured Jev is requested and a returned Huff fallback remains explicit", async ({
  page,
}) => {
  await mockLiveComparison(page, { jevConfigured: true });
  const payload = structuredClone(liveComparisonPayload);
  payload.result.requestedDemandSource = "jev";
  payload.result.fallbackReason =
    "Jev answers were unavailable for a selected site; Huff was used.";
  let requested: unknown;
  await page.route("**/api/comparisons", (route) => {
    requested = route.request().postDataJSON();
    return route.fulfill({ status: 201, json: payload });
  });
  await page.goto("/projects/houston-coffee/comparison");
  await page
    .getByRole("button", { name: "Run comparison", exact: true })
    .click();
  await expect(
    page.getByText(/Fallback reason: Jev answers were unavailable/),
  ).toBeVisible();
  expect(requested).toMatchObject({ demandSource: "jev" });
  await expect(page.getByText(/Demand source: Huff/i)).toBeVisible();
});

test("shows the Huff-only ranking check returned with a Jev comparison", async ({
  page,
}) => {
  await mockLiveComparison(page, { jevConfigured: true });
  const payload = {
    ...structuredClone(liveComparisonPayload),
    demandSourceCheck: {
      primary: "jev",
      primaryRanking: [...liveCandidateIds],
      huffRanking: [...liveCandidateIds].reverse(),
      rankingMatches: false,
      topMatches: false,
    },
  };
  await page.route("**/api/comparisons", (route) =>
    route.fulfill({ status: 201, json: payload }),
  );
  await page.goto("/projects/houston-coffee/comparison");
  await page
    .getByRole("button", { name: "Run comparison", exact: true })
    .click();
  await expect(
    page.getByText(/Huff-only check: the top site differs/),
  ).toBeVisible();
  await expect(page.getByText(/Huff order:/)).toBeVisible();
});

test("leads with the robustness headline, naming sites by address (HAC-62)", async ({
  page,
}) => {
  await mockLiveComparison(page, { jevConfigured: true });
  const [leader, other] = liveComparisonPayload.result.ranking;
  const payload = {
    ...structuredClone(liveComparisonPayload),
    robustness: {
      headline: `${leader} leads under current assumptions; ${other} leads if demand (market share) falls below 0.70× its current level.`,
      leaderSiteId: leader,
      tiedSiteIds: [],
      mostInfluential: {
        assumption: "market_share_scale",
        breakEven: 0.7,
        unit: "multiplier",
        relativeDistance: 0.3,
        fromSiteId: other,
        toSiteId: leader,
      },
      robustTo: ["rent"],
      jevHuffAgree: false,
      missingInformation: [
        "Your own sales or visitor counts from another location, to calibrate demand.",
      ],
    },
  };
  await page.route("**/api/comparisons", (route) =>
    route.fulfill({ status: 201, json: payload }),
  );
  await page.goto("/projects/houston-coffee/comparison");
  await page
    .getByRole("button", { name: "Run comparison", exact: true })
    .click();
  const headline = page.getByRole("region", {
    name: "Recommendation robustness",
  });
  await expect(headline.getByRole("heading", { level: 3 })).toContainText(
    "leads under current assumptions",
  );
  await expect(headline.getByRole("heading", { level: 3 })).not.toContainText(
    leader!,
  );
  await expect(headline).toContainText("disagree on the leader");
  await expect(headline).toContainText("calibrate demand");
});

test("failed sensitivity keeps the saved ranking and can retry", async ({
  page,
}) => {
  await mockLiveComparison(page);
  let failed = true;
  const { liveSensitivityPayload } = await import("./live-comparison-fixtures");
  await page.route(
    `**/api/comparisons/${liveComparisonId}/sensitivity`,
    (route) =>
      failed
        ? route.fulfill({
            status: 503,
            json: { message: "Sensitivity unavailable" },
          })
        : route.fulfill({ json: liveSensitivityPayload() }),
  );
  await page.goto("/projects/houston-coffee/comparison");
  await page
    .getByRole("button", { name: "Run comparison", exact: true })
    .click();
  await page
    .getByRole("button", { name: "Run sensitivity", exact: true })
    .click();
  await expect(
    page
      .getByRole("alert")
      .filter({ hasText: /could not be run|unavailable/i }),
  ).toContainText(/sensitivity/i);
  await expect(
    page.getByRole("table", { name: /Live comparison/ }),
  ).toBeVisible();
  failed = false;
  await page
    .getByRole("button", { name: "Run sensitivity", exact: true })
    .click();
  await expect(
    page.getByText("The top site changes within the tested range."),
  ).toBeVisible();
});

test("rerunning a permalink adopts the new comparison for URL and focus refresh", async ({
  page,
}) => {
  await mockLiveComparison(page);
  const nextId = "comparison-synthetic-57-b";
  const next = JSON.parse(
    JSON.stringify(liveComparisonPayload).replaceAll(liveComparisonId, nextId),
  ) as typeof liveComparisonPayload;
  const reads: string[] = [];
  await page.route("**/api/comparisons/*?*", (route) => {
    const id = decodeURIComponent(
      new URL(route.request().url()).pathname.split("/").pop()!,
    );
    reads.push(id);
    return route.fulfill({
      json: id === nextId ? next : liveComparisonPayload,
    });
  });
  await page.route("**/api/comparisons", (route) =>
    route.fulfill({ status: 201, json: next }),
  );
  await page.goto(
    `/projects/houston-coffee/comparison?comparison=${liveComparisonId}&site=201%3A301`,
  );
  await expect(
    page.getByRole("table", {
      name: `Live comparison ${liveComparisonId} · monthly contribution in USD`,
      exact: true,
    }),
  ).toBeVisible();
  await page
    .getByRole("button", { name: "Run comparison", exact: true })
    .click();
  const result = page.getByRole("table", {
    name: `Live comparison ${nextId} · monthly contribution in USD`,
    exact: true,
  });
  await expect(result).toBeVisible();
  await expect(page).toHaveURL(new RegExp(`comparison=${nextId}`));
  expect(new URL(page.url()).searchParams.get("site")).toBe("201:301");
  reads.length = 0;
  const refreshed = page.waitForResponse(
    (response) =>
      response.request().method() === "GET" &&
      new URL(response.url()).pathname === `/api/comparisons/${nextId}`,
  );
  await page.evaluate(() => window.dispatchEvent(new Event("focus")));
  await refreshed;
  await expect(result).toBeVisible();
  expect(reads).toContain(nextId);
  expect(reads).not.toContain(liveComparisonId);
});

test("comparison switches clear completed sensitivity and discard an old in-flight result", async ({
  page,
}) => {
  await mockLiveComparison(page);
  const { liveSensitivityPayload } = await import("./live-comparison-fixtures");
  const nextId = "comparison-synthetic-57-b";
  const next = JSON.parse(
    JSON.stringify(liveComparisonPayload).replaceAll(liveComparisonId, nextId),
  ) as typeof liveComparisonPayload;
  const storageKey = "sitework:comparison:v1:houston-coffee";
  const saved = {
    projectId: "houston-coffee",
    comparisonId: liveComparisonId,
    profileId: liveComparisonPayload.result.profileId,
    profileVersion: liveComparisonPayload.result.profileVersion,
    intakeFingerprint: "",
  };
  await page.addInitScript(
    ({ key, value }) => localStorage.setItem(key, JSON.stringify(value)),
    { key: storageKey, value: saved },
  );
  await page.route(`**/api/comparisons/${nextId}?*`, (route) =>
    route.fulfill({ json: next }),
  );
  await page.goto("/projects/houston-coffee/comparison");
  const oldTable = page.getByRole("table", {
    name: `Live comparison ${liveComparisonId} · monthly contribution in USD`,
    exact: true,
  });
  const nextTable = page.getByRole("table", {
    name: `Live comparison ${nextId} · monthly contribution in USD`,
    exact: true,
  });
  const switchTo = async (comparisonId: string) => {
    await page.evaluate(
      ({ key, value }) => {
        const newValue = JSON.stringify(value);
        localStorage.setItem(key, newValue);
        window.dispatchEvent(new StorageEvent("storage", { key, newValue }));
      },
      { key: storageKey, value: { ...saved, comparisonId } },
    );
  };
  await expect(oldTable).toBeVisible();
  await page
    .getByRole("button", { name: "Run sensitivity", exact: true })
    .click();
  await expect(
    page.getByRole("heading", { name: "Rent ±10% result", exact: true }),
  ).toBeVisible();
  await switchTo(nextId);
  await expect(nextTable).toBeVisible();
  await expect(
    page.getByRole("heading", { name: "Rent ±10% result", exact: true }),
  ).toHaveCount(0);
  await switchTo(liveComparisonId);
  await expect(oldTable).toBeVisible();
  let release!: () => void;
  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });
  const stale = liveSensitivityPayload();
  stale.sensitivity.conclusion = "STALE A SENSITIVITY RESULT";
  await page.route(
    `**/api/comparisons/${liveComparisonId}/sensitivity`,
    async (route) => {
      await gate;
      await route.fulfill({ json: stale }).catch(() => {}); // A correct controller may already have aborted this request.
    },
  );
  const pending = page.waitForRequest((request) =>
    request.url().endsWith(`/api/comparisons/${liveComparisonId}/sensitivity`),
  );
  await page
    .getByRole("button", { name: "Run sensitivity", exact: true })
    .click();
  const oldRequest = await pending;
  await switchTo(nextId);
  await expect(nextTable).toBeVisible();
  release();
  const response = await oldRequest.response();
  if (response) await response.finished();
  await expect(
    page.getByRole("button", { name: "Run sensitivity", exact: true }),
  ).toBeEnabled();
  await expect(
    page.getByText("STALE A SENSITIVITY RESULT", { exact: true }),
  ).toHaveCount(0);
  await expect(nextTable).toBeVisible();
});
