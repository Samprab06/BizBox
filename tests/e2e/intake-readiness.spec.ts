import { test, expect } from "@playwright/test";
import { fields } from "../../components/intake/profile";

const values = {
  concept: "Neighborhood coffee",
  category: "Coffee shop",
  city: "Houston",
  areas: "Any",
  rent: "4500",
  buildout: "120000",
  price: "Midrange",
  customers: "Neighbors",
  hours: "7am–5pm",
  staff: "2",
  requirements: "none",
};
const profile = Object.fromEntries(
  fields.map(({ key }) => [key, { value: values[key], origin: "founder" }]),
);
const key = "sitework:intake:v1:houston-coffee";

test.beforeEach(async ({ page }) => {
  await page.route("**/api/**", (route) =>
    route.fulfill({ status: 503, json: { message: "Offline readiness test" } }),
  );
  await page.route("**/api/projects/*/intake", (route) =>
    route.fulfill({ json: { modelConfigured: false } }),
  );
});

test("filled guided fields keep authoritative missing economics visible and ask for them in chat", async ({
  page,
}) => {
  const session = {
    profile,
    messages: [],
    live: {
      state: { draft: {}, assumptions: {} },
      missingRequiredFields: [
        "economics.averageTicketCents",
        "economics.startupBudgetCents",
        "economics.monthlyOperatingBudgetCents",
      ],
      findings: [],
    },
  };
  await page.addInitScript(
    ({ key, session }) => localStorage.setItem(key, JSON.stringify(session)),
    { key, session },
  );
  await page.goto("/projects/houston-coffee/intake?mode=form");
  await expect(
    page.getByText(/assistant will ask.*economics.*chat/i),
  ).toBeVisible();
  await expect(
    page.getByText(/Agent still needs: economics.averageTicketCents/),
  ).toBeVisible();
  await expect(
    page.getByText("All required fields are filled.", { exact: true }),
  ).toHaveCount(0);
});

test("filled form without an agent result stays unreviewed", async ({
  page,
}) => {
  await page.addInitScript(
    ({ key, profile }) =>
      localStorage.setItem(key, JSON.stringify({ profile, messages: [] })),
    { key, profile },
  );
  await page.goto("/projects/houston-coffee/intake?mode=form");
  await expect(
    page.getByText(/assistant has not reviewed the full profile/i),
  ).toBeVisible();
  await expect(
    page.getByText("All required fields are filled.", { exact: true }),
  ).toHaveCount(0);
});

test("an offline local edit makes a prior authoritative completion await review", async ({
  page,
}) => {
  const session = {
    profile,
    messages: [],
    live: {
      state: { draft: {}, assumptions: {} },
      missingRequiredFields: [],
      findings: [],
    },
  };
  await page.addInitScript(
    ({ key, session }) => localStorage.setItem(key, JSON.stringify(session)),
    { key, session },
  );
  await page.goto("/projects/houston-coffee/intake?mode=form");
  await expect(
    page.getByText("All required fields are filled.", { exact: true }),
  ).toBeVisible();
  await page
    .getByLabel("Monthly rent ceiling ($)", { exact: true })
    .fill("5000");
  await page.getByLabel("Monthly rent ceiling ($)", { exact: true }).blur();
  await expect(
    page.getByText(/latest edits are awaiting the assistant.*review/i),
  ).toBeVisible();
  await expect(
    page.getByText("All required fields are filled.", { exact: true }),
  ).toHaveCount(0);
  expect(
    JSON.parse((await page.evaluate((key) => localStorage.getItem(key), key))!)
      .pending,
  ).toContain("rent");
});
