import { expect, openConsultant, test } from "./fixtures";
import { fields } from "../../components/intake/profile";
import { syntheticHoustonFixture } from "../../fixtures/houston-coffee";
import { IntakeRequestSchema } from "../../lib/contracts/intake";
import { SiteSearchResultSchema } from "../../lib/contracts/sites";

// Invented test listings and intercepted services only. No provider or database requests.
test("the displayed workspace site accompanies 'compare this one' in the real chat request", async ({
  page,
}) => {
  const values = {
    concept: "Coffee for commuters",
    category: "Coffee shop",
    city: "Houston",
    areas: "Any",
    rent: "4000",
    buildout: "80000",
    price: "Midrange",
    customers: "Commuters",
    hours: "7am–5pm",
    staff: "2",
    requirements: "none",
  };
  const session = {
    profile: Object.fromEntries(
      fields.map(({ key }) => [key, { value: values[key], origin: "founder" }]),
    ),
    messages: [],
  };
  await page.addInitScript(
    (saved) =>
      localStorage.setItem(
        "sitework:intake:v1:houston-coffee",
        JSON.stringify(saved),
      ),
    session,
  );
  const candidate = {
    ...syntheticHoustonFixture.candidates[0],
    id: "test-screen",
    projectId: "houston-coffee",
    synthetic: false,
    name: "Test listing",
    address: "100 Invented Street",
  };
  const metric = candidate.monthlyRentCents;
  const result = SiteSearchResultSchema.parse({
    candidates: [
      {
        candidate,
        propertyId: "test-property",
        listingId: "test-listing",
        position: null,
        score: 10,
        scoreComponents: {
          rentFit: 10,
          sizeFit: 0,
          position: 0,
          frontage: 0,
          anchorCotenants: 0,
        },
        scoreEvidenceId: "test-evidence",
        baseRentCents: metric,
        opexCents: metric,
        totalMonthlyCostCents: metric,
        flags: [],
        evidenceIds: ["test-evidence"],
        sources: [],
      },
    ],
    filters: [],
    mostRestrictiveFilter: null,
    emptyReason: null,
    totalMatched: 1,
    evidence: [],
    modelVersion: "site-prescore-v1",
  });
  let posted: unknown;
  await page.route("**/api/**", (route) =>
    route.fulfill({
      status: 503,
      json: { message: "Test service unavailable" },
    }),
  );
  await page.route("**/api/sites", (route) => route.fulfill({ json: result }));
  await page.route("**/api/projects/*/intake", async (route) => {
    if (route.request().method() === "GET")
      return route.fulfill({ json: { modelConfigured: true } });
    posted = route.request().postDataJSON();
    const input = IntakeRequestSchema.parse(posted);
    return route.fulfill({
      json: {
        draft: input.state?.draft ?? {},
        assumptions: input.state?.assumptions ?? {},
        missingRequiredFields: [],
        findings: [],
        nextQuestion: null,
        assistantMessage: "I see the selected test space.",
        actions: [],
      },
    });
  });
  await page.goto("/projects/houston-coffee/workspace");
  // HAC-162 leaves arrival unselected. The chat context must follow the unit
  // the founder actually opens, rather than an automatic first-listing choice.
  await expect(
    page.getByRole("region", { name: "Selected location" }),
  ).toHaveCount(0);
  await page.getByRole("button", { name: /^Show list/ }).click();
  await page
    .getByRole("group", { name: "Matching locations" })
    .getByRole("button", { name: /^View 100 Invented Street/ })
    .click();
  await openConsultant(page);
  await expect(
    page.getByRole("complementary", { name: "Assistant" }),
  ).toHaveCount(1);
  await expect(
    page.getByRole("complementary", { name: "Project context" }),
  ).toHaveCount(1);
  await expect(
    page.getByRole("region", { name: "Selected location" }),
  ).toContainText(candidate.address);
  const composer = page.getByRole("textbox", {
    name: "Message the BizBox assistant",
  });
  await composer.fill("Compare this one with the cheapest");
  await page.getByRole("button", { name: "Send message", exact: true }).click();
  await expect(page.getByRole("log", { name: "Conversation" })).toContainText(
    "I see the selected test space.",
  );
  const input = IntakeRequestSchema.parse(posted);
  expect(input.view).toEqual({
    stage: "workspace",
    phase: "live",
    siteId: candidate.id,
    candidateIds: [candidate.id],
  });
  expect(input.state?.draft.economics?.averageTicketCents?.origin).toBe(
    "default",
  );
  expect(JSON.stringify(input.view)).not.toContain(candidate.address);
});
