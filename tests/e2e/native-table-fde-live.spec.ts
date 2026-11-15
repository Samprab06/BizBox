import { expect, test } from "@playwright/test";
import { readFileSync, writeFileSync } from "node:fs";
import { IntakeDraftSchema } from "../../lib/contracts/intake";
// Opt-in: restores an actual saved-case browser precondition; no API/result/policy mocks.
test("actual FDE table request previews native furniture then runs a reviewed finding", async ({
  page,
}) => {
  test.skip(
    process.env.E2E_EXPECT_NATIVE_FDE !== "1",
    "Requires the configured owned actual case and authorized provider budget",
  );
  test.setTimeout(180000);
  await page.setViewportSize({ width: 1600, height: 1200 });
  const actual = JSON.parse(
    readFileSync(
      process.env.E2E_NATIVE_CASE_FILE ??
        "/tmp/bizbox-fde-native-qa-source.json",
      "utf8",
    ),
  );
  const profile = actual.profile,
    siteId = "18263192:15256242",
    http: unknown[] = [],
    errors: string[] = [];
  let inference = 0,
    preparations = 0;
  page.on("pageerror", (error) => errors.push(error.message));
  page.on("response", async (response) => {
    const url = new URL(response.url());
    if (!url.pathname.startsWith("/api/")) return;
    const entry = {
      path: url.pathname,
      status: response.status(),
      method: response.request().method(),
    };
    http.push(entry);
    if (entry.method === "POST" && /\/intake$/.test(entry.path)) inference++;
    if (entry.method === "POST" && /\/interior-policies$/.test(entry.path))
      preparations++;
    writeFileSync(
      "/tmp/bizbox-native-fde-http.json",
      JSON.stringify(http, null, 2),
    );
  });
  const amount = (value: number | null) =>
      value === null ? "" : String(value / 100),
    clock = (value: number) =>
      `${String(Math.floor(value / 60)).padStart(2, "0")}:${String(value % 60).padStart(2, "0")}`;
  const answers = {
    concept: profile.concept,
    category: "Coffee shop",
    city: profile.city,
    areas: "Favor green-selected area in Los Angeles",
    rent: amount(profile.economics.monthlyRentCeilingCents.value),
    buildout: amount(profile.economics.buildoutBudgetCents.value),
    price: "Premium",
    customers: (profile.targetCustomers ?? []).join(", "),
    hours: `${clock(profile.operatingHours.openMinute)}–${clock(profile.operatingHours.closeMinute)}`,
    staff: String(profile.capacity.servers.value),
    requirements: "nun",
  };
  const draft = IntakeDraftSchema.parse(
    Object.fromEntries(
      Object.entries(profile).filter(([key]) => key in IntakeDraftSchema.shape),
    ),
  );
  await page.addInitScript(
    ({ actual, answers, draft }) => {
      const id = actual.projectId;
      if (!localStorage.getItem(`native-fde-case:${actual.comparisonId}`)) {
        localStorage.setItem(
          `sitework:intake:v1:${id}`,
          JSON.stringify({
            profile: Object.fromEntries(
              Object.entries(answers).map(([key, value]) => [
                key,
                { value, origin: "founder" },
              ]),
            ),
            messages: [],
            live: {
              state: { draft, assumptions: {} },
              missingRequiredFields: [],
              findings: [],
            },
          }),
        );
        localStorage.setItem(
          `sitework:shortlist:v1:${id}`,
          JSON.stringify(
            actual.request.sites.map((site: { siteId: string }) => site.siteId),
          ),
        );
        localStorage.setItem(
          `bizbox:flow:v1:${id}`,
          JSON.stringify({
            reached: ["questions", "locations", "compare", "results"],
            siteTweaks: {},
            finalPlan: null,
          }),
        );
        localStorage.setItem(`bizbox:workspace-greeted:v1:${id}`, "1");
        localStorage.setItem(`native-fde-case:${actual.comparisonId}`, "1");
      }
    },
    { actual, answers, draft },
  );
  const actualSearchPromise = page.waitForResponse(
    (response) => new URL(response.url()).pathname === "/api/sites",
    { timeout: 30000 },
  );
  await page.goto(
    `/projects/${actual.projectId}/workspace?step=results&comparison=${actual.comparisonId}`,
  );
  const chosen = page.locator(`[data-site-id="${siteId}"]`);
  console.log(
    JSON.stringify({
      phase: "actual-case-open",
      url: page.url(),
      profileId: profile.id,
      profileVersion: profile.version,
      siteId,
    }),
  );
  // Resolve the actual address from the live search payload, never a source fixture.
  const searchResponse = await actualSearchPromise;
  const search = searchResponse ? await searchResponse.json() : null;
  const address = search?.candidates?.find(
    (entry: { candidate: { id: string } }) => entry.candidate.id === siteId,
  )?.candidate.address;
  if (address)
    await page
      .getByRole("button", {
        name: new RegExp(
          `^Choose ${address.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}`,
        ),
      })
      .first()
      .click();
  else if (await chosen.count())
    await chosen.getByRole("button", { name: /^Choose / }).click();
  else
    throw new Error(
      `Actual selected site ${siteId} is not available in the current result UI`,
    );
  const stage = page.getByRole("region", {
    name: "Selected building interior",
  });
  await expect(
    stage.locator('iframe[title="Selected Matterport interior"]'),
  ).toBeVisible({ timeout: 60000 });
  await expect(stage.locator('[data-sdk-state="connected"]')).toBeVisible({
    timeout: 60000,
  });
  await page.screenshot({
    path: "/tmp/bizbox-native-fde-before.png",
    fullPage: true,
  });
  const message = page.getByRole("textbox", {
    name: /Message the BizBox assistant/,
  });
  await message.fill("What happens if I add another table here?");
  await page.getByRole("button", { name: "Send message", exact: true }).click();
  await expect(
    stage.locator('[data-furniture-state="ready"][data-proposed-items="1"]'),
  ).toBeVisible({ timeout: 45000 });
  await page.screenshot({
    path: "/tmp/bizbox-native-fde-table.png",
    fullPage: true,
  });
  writeFileSync(
    "/tmp/bizbox-native-fde-checkpoint.json",
    JSON.stringify(
      await page.evaluate(
        (id) =>
          Object.fromEntries(
            Object.entries(localStorage).filter(([key]) => key.includes(id)),
          ),
        actual.projectId,
      ),
      null,
      2,
    ),
    { mode: 0o600 },
  );
  await expect(
    stage.getByRole("region", { name: "Experiment finding" }),
  ).toBeVisible({ timeout: 60000 });
  await expect(stage).toContainText("Walking (seconds)");
  await expect(stage).toContainText("Operating contribution / day");
  expect(preparations).toBeLessThanOrEqual(1);
  expect(inference).toBeLessThanOrEqual(3);
  await stage.getByRole("button", { name: "Keep result", exact: true }).click();
  await stage
    .getByRole("button", { name: "Continue to report", exact: true })
    .click();
  await expect(page).toHaveURL(/step=finalize/);
  const saved = await page.evaluate(
    (id) => JSON.parse(localStorage.getItem(`bizbox:flow:v1:${id}`)!),
    actual.projectId,
  );
  expect(saved.finalPlan.interior.draft.items).toHaveLength(1);
  expect(saved.finalPlan.interior.finding.change.type).toBe("add");
  await page.screenshot({
    path: "/tmp/bizbox-native-fde-report.png",
    fullPage: true,
  });
  expect(page.url()).toMatch(/step=finalize/);
  console.log(
    JSON.stringify({
      phase: "completed",
      url: page.url(),
      preparations,
      inference,
      modelId: saved.finalPlan.interior.source.modelId,
      source: saved.finalPlan.interior.finding.source,
      errors,
    }),
  );
  expect(
    errors.filter((error) =>
      /maximum update depth|null.*add|too many re-renders/i.test(error),
    ),
  ).toEqual([]);
});
