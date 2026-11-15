import type { Page } from "@playwright/test";
import {
  closeConsultant,
  expect,
  expectNoA11yViolations,
  openConsultant,
  test,
} from "./fixtures";
import {
  mockLiveComparison,
  liveComparisonSearch,
  liveComparisonPayload,
  liveComparisonId,
  comparisonForCandidates,
} from "./live-comparison-fixtures";

// Invented API test responses exercise the production source branches. These are not
// vendor data or evidence that live inventory, imagery, scans or Jev were verified.
async function services(
  page: Page,
  options: { renderer?: "unavailable" } = {},
) {
  if (options.renderer === "unavailable") {
    // Exercise native conversation/facts with WebGL unavailable. Dedicated map
    // and geometry cases retain the real renderer; 2D canvas remains native.
    await page.addInitScript(() => {
      HTMLCanvasElement.prototype.getContext = new Proxy(
        HTMLCanvasElement.prototype.getContext,
        {
          apply(target, receiver, args) {
            return /^(webgl2?|experimental-webgl)$/.test(args[0])
              ? null
              : Reflect.apply(target, receiver, args);
          },
        },
      );
    });
  }
  const appOrigin = new URL("/", test.info().project.use.baseURL).origin;
  // This conversation/facts fixture does not verify provider imagery. Keep real
  // context-tile downloads and decoding out of its native interaction timings.
  // A later explicit provider fixture (such as Matterport below) takes precedence.
  await page.route(
    (url) => /^https?:$/.test(url.protocol) && url.origin !== appOrigin,
    (route) => route.abort("blockedbyclient"),
  );
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

async function showList(page: Page) {
  if (
    !(await page.getByRole("group", { name: "Matching locations" }).isVisible())
  )
    await page.getByRole("button", { name: /^Show list/ }).click();
}
/** HAC-162 on main: the chat is the consultant dock, not a pane inside the workspace. */
async function showChat(page: Page) {
  await openConsultant(page);
}

test("compact desktop window expands with the map pane matching its backdrop", async ({
  page,
}) => {
  await services(page);
  await page.setViewportSize({ width: 500, height: 900 });
  await page.goto("/projects/houston-coffee/workspace");
  await expect(page.getByRole("button", { name: /^Show list/ })).toBeVisible();
  const map = page.locator("[data-map-viewport]");
  // Presentation geometry exists with or without configured provider imagery.
  const backdrop = map
    .locator("..")
    .locator("..")
    .locator(":scope > div")
    .first();
  async function expectMapGeometry() {
    await expect
      .poll(async () => {
        const pane = await map.boundingBox();
        const scene = await backdrop.boundingBox();
        return pane && scene
          ? Math.max(
              Math.abs(pane.height - scene.height),
              Math.abs(pane.y - scene.y),
              Math.abs(pane.x - scene.x),
            )
          : Infinity;
      })
      .toBeLessThan(2);
  }
  await expectMapGeometry();
  expect((await map.boundingBox())!.height).toBeGreaterThan(350);
  await page.setViewportSize({ width: 1000, height: 852 });
  await expectMapGeometry();
  const canvas = page
    .getByRole("region", { name: "Vexcel 3D neighborhood" })
    .locator("canvas");
  if (await canvas.count()) {
    await expect(canvas).toBeVisible();
    await expect
      .poll(async () => {
        const pane = await page.locator("[data-map-viewport]").boundingBox();
        const scene = await canvas.boundingBox();
        return pane && scene ? Math.abs(pane.height - scene.height) : Infinity;
      })
      .toBeLessThan(2);
  }
  const pane = await page.locator("[data-map-viewport]").boundingBox();
  expect(pane!.height).toBeGreaterThan(650);
  expect(pane!.width).toBeGreaterThan(500);
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBe(true);
  await page.screenshot({ path: "/tmp/bizbox-expanded-desktop-fixture.png" });
});

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
      const { posts } = await services(page, { renderer: "unavailable" });
      await page.goto("/projects/houston-coffee/workspace");
      const locations = page.getByRole("group", { name: "Matching locations" });
      await expect(locations).toHaveCount(0);
      await expect(
        page.getByRole("region", { name: "Selected location" }),
      ).toHaveCount(0);
      await expect(
        page.getByText("City preview · photo, not a map"),
      ).toHaveCount(0);
      expect(posts).toHaveLength(0);
      const composer = page.getByRole("textbox", {
        name: "Message the BizBox assistant",
      });
      await openConsultant(page);
      await composer.fill("Keep this question while I explore");
      await closeConsultant(page);
      await showList(page);
      await locations
        .getByRole("button", {
          name: "View 101 Invented St · Unit 1",
          exact: true,
        })
        .click();
      await page
        .getByRole("button", { name: "Add to comparison", exact: true })
        .click();
      await page
        .getByRole("button", { name: "Choose another unit", exact: true })
        .click();
      await locations
        .getByRole("button", {
          name: "View 202 Invented St · Unit 1",
          exact: true,
        })
        .click();
      await page
        .getByRole("button", { name: "Add to comparison", exact: true })
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
      await openConsultant(page);
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
      await closeConsultant(page);
      await page
        .getByRole("button", { name: "Locations", exact: true })
        .click();
      await page
        .getByRole("button", { name: "Compare 2 units", exact: true })
        .click();
      await expect(
        page.getByRole("region", { name: "Unit comparison" }),
      ).toContainText("Listing facts");
      expect(posts).toEqual([]);
      // The consultant dock stays available beside (or, on a phone, over) the comparison.
      await showChat(page);
      await expect(composer).toBeVisible();
      await closeConsultant(page);
      await page
        .getByRole("button", { name: "Run comparison", exact: true })
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
      // Scene 1: results are their own step; "Change a site" returns to the list, and a new
      // selection locks the later steps again.
      await expect(page).toHaveURL(/step=results/);
      await page
        .getByRole("button", { name: "Change a site", exact: true })
        .click();
      await expect(page).toHaveURL(/step=locations/);
      await showList(page);
      await locations
        .getByRole("checkbox", { name: "Compare 202 Invented St" })
        .uncheck();
      await expect(
        page.getByRole("region", { name: "Location comparison results" }),
      ).toHaveCount(0);
      await expect(
        page.getByRole("button", { name: "Compare 2 units", exact: true }),
      ).toBeDisabled();
      await expect(
        page
          .getByRole("navigation", { name: "Progress" })
          .locator('[data-flow-step="results"]'),
      ).toHaveAttribute("data-flow-status", "locked");
      await openConsultant(page);
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
  await page.goto("/projects/houston-coffee/workspace?site=201%3A301");
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
    page.getByRole("button", { name: "Compare 2 units", exact: true }),
  ).toHaveCount(0);
  await expect(
    page.getByText("Montrose storefront", { exact: true }),
  ).toHaveCount(0);
});

test("unit labels, explicit selection up to three and failed comparison retain exactly the chosen source facts", async ({
  page,
}) => {
  const { search } = await services(page, { renderer: "unavailable" });
  const a = structuredClone(search.candidates[0]),
    b = structuredClone(search.candidates[1]),
    c = structuredClone(search.candidates[0]);
  b.propertyId = a.propertyId;
  b.candidate.address = a.candidate.address;
  b.candidate.floorAreaSqFt.value = 1600;
  b.baseRentCents.value = 190000;
  c.candidate.id = "203:303";
  c.propertyId = "103";
  c.listingId = "203";
  c.candidate.address = "303 Other St";
  const d = structuredClone(c);
  d.candidate.id = "204:304";
  d.propertyId = "104";
  d.listingId = "204";
  d.candidate.address = "404 Fourth St";
  search.candidates = [b, c, a, d];
  search.totalMatched = 4;
  const attempts: string[][] = [];
  await page.route("**/api/comparisons", (route) => {
    attempts.push(route.request().postDataJSON().candidateIds);
    return route.fulfill({
      status: 503,
      json: { message: "Test service unavailable" },
    });
  });
  await page.goto("/projects/houston-coffee/workspace");
  await expect(page.getByText("Comparison 0/3", { exact: true })).toBeVisible();
  await showList(page);
  await expect(
    page.getByRole("checkbox", {
      name: "Compare 101 Invented St · Unit 1",
      exact: true,
    }),
  ).not.toBeChecked();
  await page
    .getByRole("button", { name: "View 101 Invented St · Unit 2", exact: true })
    .click();
  const property = page.getByRole("region", { name: "Selected location" });
  await expect(property).toContainText("101 Invented St · Unit 2");
  await page
    .getByRole("button", { name: "Add to comparison", exact: true })
    .click();
  await property
    .getByRole("region", { name: "Spaces at this location" })
    .getByRole("button", { name: /^Unit 1\b/ })
    .click();
  await page
    .getByRole("button", { name: "Add to comparison", exact: true })
    .click();
  const tray = page.getByRole("region", { name: "Comparison shortlist" });
  await expect(tray).toContainText("Comparison 2/3");
  await expect(tray).toContainText("101 Invented St · Unit 1");
  await expect(tray).toContainText("101 Invented St · Unit 2");
  expect(attempts).toEqual([]);
  await page
    .getByRole("button", { name: "Choose another unit", exact: true })
    .click();
  await page
    .getByRole("button", { name: "View 303 Other St · Unit 1", exact: true })
    .click();
  await page
    .getByRole("button", { name: "Add to comparison", exact: true })
    .click();
  await expect(tray).toContainText("Comparison 3/3");
  // Scene 1: at most three units; a fourth waits until one is removed.
  await page
    .getByRole("button", { name: "Choose another unit", exact: true })
    .click();
  await page
    .getByRole("button", { name: "View 404 Fourth St · Unit 1", exact: true })
    .click();
  await expect(
    page.getByRole("button", { name: "Add to comparison", exact: true }),
  ).toBeDisabled();
  await expect(property).toContainText("Remove one to add this unit");
  await tray
    .getByRole("button", {
      name: "Remove 101 Invented St · Unit 1",
      exact: true,
    })
    .click();
  await expect(
    page.getByRole("button", { name: "Add to comparison", exact: true }),
  ).toBeEnabled();
  await page
    .getByRole("button", { name: "Compare 2 units", exact: true })
    .click();
  const comparison = page.getByRole("region", { name: "Unit comparison" });
  await expect(comparison).toContainText("101 Invented St · Unit 2");
  await expect(comparison).toContainText("303 Other St · Unit 1");
  await openConsultant(page);
  await expect(
    page.getByRole("textbox", { name: "Message the BizBox assistant" }),
  ).toBeVisible();
  await closeConsultant(page);
  expect(attempts).toEqual([]);
  await page
    .getByRole("button", { name: "Run comparison", exact: true })
    .click();
  await expect(comparison.getByRole("alert")).toContainText(
    "Comparison unavailable",
    { timeout: 15_000 },
  );
  expect(attempts).toEqual([["202:302", "203:303"]]);
  await expect(
    comparison.getByRole("table", {
      name: "Source listing facts for the two chosen units",
    }),
  ).toBeVisible();
  await expect(
    page.getByRole("region", { name: "Location comparison results" }),
  ).toHaveCount(0);
  await page
    .getByRole("button", { name: "Retry comparison", exact: true })
    .click();
  await expect.poll(() => attempts.length).toBe(2);
  expect(attempts[1]).toEqual(["202:302", "203:303"]);
  await page.screenshot({ path: "/tmp/bizbox-unit-comparison-facts.png" });
  await expectNoA11yViolations(page);
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
  messages: [] as { role: "agent" | "founder"; text: string }[],
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
  test("completed brief replaces only the obsolete opener in Text and Voice presentation", async ({
    page,
  }) => {
    const brief = inventedBrief();
    const opener =
      "What kind of business are you opening? Describe the concept in a sentence or two.";
    const saved = {
      ...brief,
      messages: [{ role: "agent" as const, text: opener }],
    };
    await readinessServices(page, saved);
    await page.route("**/api/sites", (route) =>
      route.fulfill({ status: 503, json: {} }),
    );
    await page.goto("/projects/houston-coffee/workspace");
    const note = page.getByRole("note", { name: "Saved brief" });
    await expect(note).toHaveText(
      "Coffee shop · Houston · Rent limit $4,500/mo",
    );
    await expect(page.getByText(opener, { exact: true })).toHaveCount(0);
    await expect(
      page.getByRole("textbox", { name: "Message the BizBox assistant" }),
    ).toHaveAttribute("placeholder", "Ask about your saved brief…");
    await expect(
      page.getByText(
        "The BizBox assistant is offline. Your brief can still be edited in Intake.",
      ),
    ).toBeVisible();
    await page.getByRole("tab", { name: "Voice", exact: true }).click();
    await page.getByText("Conversation", { exact: true }).click();
    await expect(note).toBeVisible();
    expect(
      await page.evaluate(
        () =>
          JSON.parse(localStorage.getItem("sitework:intake:v1:houston-coffee")!)
            .messages,
      ),
    ).toEqual(saved.messages);
    await page.getByRole("tab", { name: "Text", exact: true }).click();
    await page.evaluate(() => {
      const key = "sitework:intake:v1:houston-coffee";
      const session = JSON.parse(localStorage.getItem(key)!);
      session.messages.push(
        { role: "founder", text: "Keep this actual question" },
        { role: "agent", text: "Keep this actual reply" },
      );
      localStorage.setItem(key, JSON.stringify(session));
      window.dispatchEvent(
        new CustomEvent("sitework:intake-updated", { detail: { key } }),
      );
    });
    await expect(page.getByRole("log", { name: "Conversation" })).toContainText(
      "Keep this actual question",
    );
    await expect(page.getByRole("log", { name: "Conversation" })).toContainText(
      "Keep this actual reply",
    );
    await expect(note).toHaveCount(0);
    await expectNoA11yViolations(page);
  });
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
    await showList(page);
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
    await showList(page);
    await locations
      .getByRole("button", {
        name: "View 202 Invented St · Unit 1",
        exact: true,
      })
      .click();
    await expect(
      page.getByRole("region", { name: "Selected location" }),
    ).toContainText("202 Invented St");
    await showChat(page);
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
    // The chat is the consultant dock, so the property pane never closed.
    await expect(
      page.getByRole("region", { name: "Selected location" }),
    ).toContainText("202 Invented St");
    await expect(page).toHaveURL(/site=202%3A302/);
    await showChat(page);
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
    ).toHaveCount(0);
    await expect(page).not.toHaveURL(/[?&]site=/);
    await showList(page);
    await expect(
      locations.getByRole("button", {
        name: "View 202 Invented St · Unit 1",
        exact: true,
      }),
    ).toHaveCount(0);
    await showChat(page);
    await expect(
      page.getByRole("textbox", { name: "Message the BizBox assistant" }),
    ).toHaveValue("Retain this draft");
    await expectNoA11yViolations(page);
  });
});

for (const width of [1366, 500, 640, 820]) {
  test.describe(`map-first desktop preview ${width}`, () => {
    test.use({ viewport: { width, height: 900 } });
    if (width === 1366)
      test("keyboard discovery moves focus into property details and returns to the map action", async ({
        page,
      }) => {
        await services(page);
        await page.goto("/projects/houston-coffee/workspace");
        const show = page.getByRole("button", { name: /^Show list/ });
        await show.focus();
        await page.keyboard.press("Enter");
        const option = page.getByRole("button", {
          name: "View 101 Invented St · Unit 1",
          exact: true,
        });
        await option.focus();
        await page.keyboard.press("Enter");
        const property = page.getByRole("region", {
          name: "Selected location",
        });
        await expect(property).toBeFocused();
        await property
          .getByRole("button", { name: "Close property details" })
          .focus();
        await page.keyboard.press("Enter");
        await expect(show).toBeFocused();
        await expect(property).toHaveCount(0);
      });
    test("arrival is clear; explicit list selection reveals grouped facts and Close clears a deep link", async ({
      page,
    }) => {
      const { search, posts } = await services(page);
      search.candidates[1].propertyId = search.candidates[0].propertyId;
      search.candidates[1].candidate.floorAreaSqFt.value = 1600;
      search.candidates[1].baseRentCents.value = 190000;
      await page.route("**/api/sites", (route) =>
        route.fulfill({ json: search }),
      );
      await page.goto("/projects/houston-coffee/workspace");
      await expect(
        page.getByRole("button", { name: "Show list (2 units)" }),
      ).toBeVisible();
      await expect(
        page.getByRole("region", { name: "Selected location" }),
      ).toHaveCount(0);
      await expect(
        page.getByRole("group", { name: "Matching locations" }),
      ).toHaveCount(0);
      await expect(page.locator("[data-map-sheet]")).toHaveCount(0);
      await showList(page);
      await expect(
        page.getByText("2 of 2 matching units shown", { exact: true }),
      ).toBeVisible();
      await page
        .getByRole("button", {
          name: "View 101 Invented St · Unit 1",
          exact: true,
        })
        .click();
      const property = page.getByRole("region", { name: "Selected location" });
      await expect(property).toBeVisible();
      await expect(property).toContainText("Asking rent / month");
      const units = property.getByRole("region", {
        name: "Spaces at this location",
      });
      await expect(units.getByRole("button")).toHaveCount(2);
      await units.getByRole("button", { name: /1,600 sq ft/ }).click();
      await expect(page).toHaveURL(/site=202%3A302/);
      await expect(property).toContainText("202 Invented St");
      const viewport = await page.locator("[data-map-viewport]").boundingBox();
      const panel = await property.boundingBox();
      expect(viewport!.height).toBeGreaterThan(350);
      const visualization = await page
        .locator("[data-map-viewport]")
        .evaluate((element) =>
          element.parentElement!.getBoundingClientRect().toJSON(),
        );
      expect(Math.abs(visualization.height - viewport!.height)).toBeLessThan(2);
      if (width <= 850)
        expect(panel!.y).toBeGreaterThanOrEqual(viewport!.y + viewport!.height);
      if (width > 850)
        expect(panel!.x).toBeGreaterThanOrEqual(viewport!.x + viewport!.width);
      expect(
        await page.evaluate(
          () => document.documentElement.scrollWidth <= innerWidth,
        ),
      ).toBe(true);
      await page.screenshot({ path: `/tmp/bizbox-map-first-${width}.png` });
      await property
        .getByRole("button", { name: "Close property details" })
        .click();
      await expect(page).not.toHaveURL(/[?&]site=/);
      await expect(property).toHaveCount(0);
      // Closing an initially server-rendered explicit URL must not revive its prop.
      await page.goto("/projects/houston-coffee/workspace?site=201%3A301");
      await expect(property).toContainText("101 Invented St");
      await property
        .getByRole("button", { name: "Close property details" })
        .click();
      await expect(page).not.toHaveURL(/[?&]site=/);
      await expect(property).toHaveCount(0);
      expect(posts).toHaveLength(0);
      await expectNoA11yViolations(page);
    });
  });
}
