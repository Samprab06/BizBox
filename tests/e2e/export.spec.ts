import type { Locator, Page } from "@playwright/test";
import { buildLocationPlan } from "../../lib/agent/plan";
import { fixture } from "../../lib/agent/__fixtures__/plan";
import type { PlanFact, PlanReference } from "../../lib/contracts/plan";
import { expect, test } from "./fixtures";
import {
  liveComparisonId,
  liveComparisonPayload,
  liveComparisonRecord,
  liveComparisonSearch,
  liveSensitivityPayload,
  mockLiveComparison,
} from "./live-comparison-fixtures";

// HAC-37: HAC-26 exports printable HTML through window.print(), not a download.
// Keep this journey separate from the existing plan page smoke/a11y coverage.
const PROJECT = "houston-coffee";
const planURL = `/projects/${PROJECT}/plan?comparison=${liveComparisonId}`;
const source = fixture();
source.projectId = PROJECT;
source.profile.projectId = PROJECT;
source.profile.id = liveComparisonPayload.result.profileId;
source.profile.version = liveComparisonPayload.result.profileVersion;
source.comparison = structuredClone(liveComparisonRecord);
source.comparison.evaluation.sensitivity = [
  liveSensitivityPayload().sensitivity,
];
// Explicit synthetic observations exercise all four supported origin labels.
source.comparison.evaluation.assembly = {
  findings: [],
  assumptions: {
    "synthetic.rent": {
      value: 24,
      origin: "costar",
      evidenceIds: ["test-rent"],
    },
    "synthetic.population": {
      value: 1234,
      origin: "public",
      evidenceIds: ["test-census"],
    },
    "synthetic.staff": {
      value: 2,
      origin: "founder",
      evidenceIds: ["test-founder"],
    },
    "synthetic.ticket": {
      value: 6.5,
      origin: "default",
      evidenceIds: ["test-default"],
    },
  },
};
const plan = buildLocationPlan(source);
const originLabels = {
  costar: "CoStar",
  public: "Public data",
  founder: "Founder",
  default: "Default",
};
const money = (value: number) =>
  value.toLocaleString("en-US", {
    style: "currency",
    currency: "USD",
    maximumFractionDigits: 0,
  });
const citation = (ref: PlanReference) => {
  if ("comparisonId" in ref)
    return `comparison ${ref.comparisonId} · ${ref.metric}`;
  if ("runId" in ref) return `run ${ref.runId} · ${ref.metric}`;
  return `evidence ${ref.evidenceId} · ${ref.metric}`;
};
const metricLabel = (fact: PlanFact) =>
  fact.reference.metric.replaceAll(/[._]/g, " ");

async function mockExport(page: Page, outdated = false) {
  await mockLiveComparison(page, { outdated });
  await page.route(`**/api/comparisons/${liveComparisonId}/plan?*`, (route) =>
    route.fulfill({ json: plan }),
  );
}

function factRow(section: Locator, label: string) {
  return section.getByRole("row").filter({
    has: section.page().getByRole("rowheader", { name: label, exact: true }),
  });
}

test("selected comparison exports the same identity, ranking and saved intervals", async ({
  page,
}) => {
  await mockExport(page);
  await page.goto(
    `/projects/${PROJECT}/comparison?comparison=${liveComparisonId}`,
  );
  const table = page.getByRole("table", {
    name: `Live comparison ${liveComparisonId} · monthly contribution in USD`,
    exact: true,
  });
  await expect(table).toBeVisible();
  const ranking = liveComparisonPayload.result.ranking;
  const addresses = ranking.map(
    (id) =>
      liveComparisonSearch.candidates.find((c) => c.candidate.id === id)!
        .candidate.address,
  );
  const headers = await table.getByRole("rowheader").allTextContents();
  expect(headers).toHaveLength(ranking.length);
  headers.forEach((text, index) =>
    expect(text).toContain(`${index + 1}. ${addresses[index]}`),
  );
  for (const site of liveComparisonPayload.result.sites) {
    const address = liveComparisonSearch.candidates.find(
      (c) => c.candidate.id === site.siteId,
    )!.candidate.address;
    const row = table.getByRole("row").filter({
      has: page.getByRole("rowheader").filter({ hasText: address }),
    });
    await expect(
      row.getByRole("cell", {
        name: money(site.monthlyContributionUsd.mean),
        exact: true,
      }),
    ).toBeVisible();
    await expect(
      row.getByRole("cell", {
        name: `${money(site.monthlyContributionUsd.low)} to ${money(site.monthlyContributionUsd.high)}`,
        exact: true,
      }),
    ).toBeVisible();
  }
  await page
    .getByRole("link", { name: "Export the location plan", exact: true })
    .click();
  await expect(page).toHaveURL(planURL);
  const article = page.getByRole("article", { name: "Location plan" });
  await expect(article).toContainText(`Comparison ${liveComparisonId}`);
  const why = article.getByRole("region", {
    name: "Why this site",
    exact: true,
  });
  const exportedOrder = await why.getByRole("rowheader").allTextContents();
  expect(
    exportedOrder.filter((label) => label.endsWith(" monthlyContributionUsd")),
  ).toEqual(ranking.map((id) => `${id} · sites ${id} monthlyContributionUsd`));
  for (const id of ranking) {
    const metric = liveComparisonPayload.result.sites.find(
      (s) => s.siteId === id,
    )!.monthlyContributionUsd;
    const row = factRow(why, `${id} · sites ${id} monthlyContributionUsd`);
    await expect(
      row.getByRole("cell", {
        name: `${money(metric.low)} – ${money(metric.high)} /month (range)`,
        exact: true,
      }),
    ).toBeVisible();
    await expect(row).toContainText(
      `comparison ${liveComparisonId} · sites.${id}.monthlyContributionUsd`,
    );
  }
  // Grounded plans intentionally publish intervals, rather than mean forecasts.
  await expect(article).toContainText("not a sales forecast");
});

test("every exported figure retains its origins and all of its citations", async ({
  page,
}) => {
  await mockExport(page);
  await page.goto(planURL);
  const article = page.getByRole("article", { name: "Location plan" });
  await expect(article).toBeVisible();
  const groups: [
    string,
    { label: string; origins: PlanFact["origins"]; references: string[] }[],
  ][] = [
    [
      "Why this site",
      plan.why.flatMap((why) =>
        why.facts.map((f) => ({
          label: `${why.siteId} · ${metricLabel(f)}`,
          origins: f.origins,
          references: [
            citation(f.reference),
            ...f.evidenceIds.map((id) => `evidence ${id}`),
          ],
        })),
      ),
    ],
    [
      "Conditions that change the choice",
      plan.sensitivity.flatMap((s) => [
        {
          label: `${s.assumption.replaceAll("_", " ")} · tested range`,
          origins: s.testedRange.origins,
          references: [
            citation(s.testedRange.reference),
            ...s.testedRange.evidenceIds.map((id) => `evidence ${id}`),
          ],
        },
        ...(s.flipBracket
          ? [
              {
                label: `${s.assumption.replaceAll("_", " ")} · flips between`,
                origins: s.flipBracket.origins,
                references: [
                  citation(s.flipBracket.reference),
                  ...s.flipBracket.evidenceIds.map((id) => `evidence ${id}`),
                ],
              },
            ]
          : []),
      ]),
    ],
    [
      "Lease targets",
      plan.leaseTargets.map((f) => ({
        label: metricLabel(f),
        origins: f.origins,
        references: [
          citation(f.reference),
          ...f.evidenceIds.map((id) => `evidence ${id}`),
        ],
      })),
    ],
    [
      "Staffing, stations and buildout",
      [...plan.staffingAndStations, ...plan.buildoutBudget].map((f) => ({
        label: metricLabel(f),
        origins: f.origins,
        references: [
          citation(f.reference),
          ...f.evidenceIds.map((id) => `evidence ${id}`),
        ],
      })),
    ],
    [
      "Assumptions and where they come from",
      plan.assumptions.map((a) => ({
        label: a.path,
        origins: [a.origin],
        references: [citation(a.reference)],
      })),
    ],
    [
      "First 90 days: what to check",
      plan.firstNinetyDays.map((c) => ({
        label: c.check,
        origins: [],
        references: c.references.map(citation),
      })),
    ],
  ];
  const observedOrigins = new Set<string>();
  for (const [name, expectedRows] of groups) {
    const section = article.getByRole("region", { name, exact: true });
    // Extract semantic table cells in one browser call; no class/position selectors.
    const actualRows = await section.getByRole("row").evaluateAll((rows) =>
      rows.flatMap((row) => {
        const label = row.querySelector('th[scope="row"]')?.textContent;
        return label
          ? [
              {
                label,
                cells: Array.from(
                  row.querySelectorAll("td"),
                  (cell) => cell.textContent ?? "",
                ),
              },
            ]
          : [];
      }),
    );
    expect(actualRows.map((r) => r.label)).toEqual(
      expectedRows.map((r) => r.label),
    );
    actualRows.forEach((actual, index) => {
      const expected = expectedRows[index];
      expect(actual.cells).toHaveLength(2);
      const sourceCell = actual.cells[1];
      for (const origin of expected.origins) {
        observedOrigins.add(origin);
        expect(sourceCell, `${actual.label}: origin`).toContain(
          originLabels[origin],
        );
      }
      for (const ref of expected.references)
        expect(sourceCell, `${actual.label}: citation`).toContain(ref);
      if (expected.origins.length)
        expect(actual.cells[0], `${actual.label}: value`).not.toBe("");
    });
  }
  expect([...observedOrigins].sort()).toEqual([
    "costar",
    "default",
    "founder",
    "public",
  ]);
  for (const label of [
    "CoStar",
    "U.S. Census Bureau",
    "U.S. Census Bureau LEHD",
    "Overture Maps Foundation",
  ])
    await expect(article.getByText(label, { exact: true })).toBeVisible();
});

test("outdated comparisons expose neither an export entry point nor a printable plan", async ({
  page,
}) => {
  await mockExport(page, true);
  await page.goto(
    `/projects/${PROJECT}/comparison?comparison=${liveComparisonId}`,
  );
  await expect(
    page
      .getByRole("status")
      .filter({ hasText: "This comparison is outdated." }),
  ).toBeVisible();
  await expect(
    page.getByRole("link", { name: "Export the location plan", exact: true }),
  ).toHaveCount(0);
  await page.goto(planURL);
  await expect(
    page.getByRole("alert").filter({ hasText: "This comparison is outdated." }),
  ).toBeVisible();
  await expect(
    page.getByRole("article", { name: "Location plan" }),
  ).toHaveCount(0);
  await expect(
    page.getByRole("button", { name: "Print or save as PDF" }),
  ).toHaveCount(0);
});

test("printing twice preserves deterministic HTML and readable print tables", async ({
  page,
}, testInfo) => {
  await mockExport(page);
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await page.goto(planURL);
  const article = page.getByRole("article", { name: "Location plan" });
  const print = page.getByRole("button", { name: "Print or save as PDF" });
  await expect(print).toBeVisible();
  // Install after hydration: addInitScript runs before documentElement exists.
  // This observes the real button callback without opening a native dialog.
  await page.evaluate(() => {
    document.documentElement.dataset.printCalls = "0";
    window.print = () => {
      document.documentElement.dataset.printCalls = String(
        Number(document.documentElement.dataset.printCalls) + 1,
      );
    };
  });
  const before = await article.evaluate((element) => element.outerHTML);
  await print.click();
  await print.click();
  await expect(page.locator("html")).toHaveAttribute("data-print-calls", "2");
  expect(await article.evaluate((element) => element.outerHTML)).toBe(before);
  await page.reload();
  await expect(print).toBeVisible();
  expect(await article.evaluate((element) => element.outerHTML)).toBe(before);
  await page.emulateMedia({ media: "print" });
  await expect(print).toBeHidden();
  await expect(
    page.getByRole("heading", { level: 1, name: "Location plan" }),
  ).toBeHidden();
  for (const width of [390, 768, 1440]) {
    await page.setViewportSize({ width, height: 900 });
    const clipped = await article.getByRole("cell").evaluateAll((cells) =>
      cells.flatMap((cell) => {
        const el = cell as HTMLElement;
        return el.scrollWidth > el.clientWidth + 1 ? [el.textContent] : [];
      }),
    );
    expect(clipped, `print cell overflow at ${width}px`).toEqual([]);
  }
  expect(errors).toEqual([]);
  await testInfo.attach("printable-plan.html", {
    body: before,
    contentType: "text/html",
  });
  await testInfo.attach("print-media.png", {
    body: await page.screenshot({ fullPage: true }),
    contentType: "image/png",
  });
  // PDF generation is Chromium-only; native pagination/viewer checks remain manual.
  if (testInfo.project.name === "chromium") {
    const pdf = await page.pdf({ format: "A4", printBackground: true });
    expect(pdf.subarray(0, 5).toString()).toBe("%PDF-");
    expect(pdf.byteLength).toBeGreaterThan(1000);
    await testInfo.attach("location-plan.pdf", {
      body: pdf,
      contentType: "application/pdf",
    });
  }
});
