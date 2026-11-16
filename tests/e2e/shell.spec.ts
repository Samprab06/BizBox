import type { Locator, Page } from "@playwright/test";
import {
  FLOW_STEPS,
  flowStepHref,
  type FlowStep,
} from "../../lib/client/flow-steps";
import {
  views,
  workspaceHref,
  workspaceSteps,
  type View,
  type WorkspaceRoute,
} from "../../lib/client/workspace-routes";
import { expect, test, viewHeading, expandProjectNavigation } from "./fixtures";

const DEFAULT_SITE = "montrose";
const VIEW_ORDER = Object.keys(views) as View[];
const ROUTES = workspaceSteps.map((step) => step.route);
const GUIDED_ROUTES: WorkspaceRoute[] = ["intake", "workspace", "plan"];
const progress = (page: Page) =>
  page.getByRole("navigation", { name: "Progress", exact: true });
const stepItem = (page: Page, step: FlowStep) =>
  progress(page).locator(`[data-flow-step="${step}"]`);

/** Seed reached steps only: navigation must not run a paid comparison or fabricate results. */
async function seedReachedSteps(page: Page, projectId: string) {
  await page.addInitScript(
    ({ projectId, reached }) => {
      localStorage.setItem(
        `bizbox:flow:v1:${projectId}`,
        JSON.stringify({ reached, siteTweaks: {}, finalPlan: null }),
      );
    },
    { projectId, reached: FLOW_STEPS.map((step) => step.id) },
  );
}

async function expectCurrentStep(page: Page, step: FlowStep) {
  await expect(progress(page).locator('[aria-current="step"]')).toHaveCount(1);
  await expect(stepItem(page, step).getByRole("link")).toHaveAttribute(
    "aria-current",
    "step",
  );
}

/** Follow a reached step or legacy view without relying on the removed TaskNav. */
async function followLink(page: Page, link: Locator, href: string) {
  await link.click();
  await expect(page).toHaveURL(href);
}

function trackConsole(page: Page) {
  const problems: string[] = [];
  const benignWarnings = [
    /^Expected value to be of type number, but found null instead\.$/,
    /^THREE\.Clock: This module has been deprecated\./,
    /^\[\.WebGL-.*GPU stall due to ReadPixels/,
  ];
  page.on("console", (message) => {
    if (message.type() !== "error" && message.type() !== "warning") return;
    if (
      message.type() === "warning" &&
      benignWarnings.some((pattern) => pattern.test(message.text()))
    )
      return;
    problems.push(`${message.type()}: ${message.text()}`);
  });
  page.on("pageerror", (error) => problems.push(`pageerror: ${error.message}`));
  return problems;
}

test.describe("guided navigation", () => {
  test("a fresh intake shows the ordered flow with later steps locked", async ({
    page,
    gotoView,
    projectId,
  }) => {
    await gotoView("intake");
    await expectCurrentStep(page, "questions");
    await expect(progress(page).locator("li")).toHaveCount(FLOW_STEPS.length);
    for (const { id, label } of FLOW_STEPS) {
      await expect(stepItem(page, id)).toContainText(label);
      if (id === "questions") {
        await expect(stepItem(page, id).getByRole("link")).toHaveAttribute(
          "href",
          flowStepHref(projectId, id),
        );
      } else {
        await expect(stepItem(page, id)).toHaveAttribute(
          "data-flow-status",
          "locked",
        );
        await expect(stepItem(page, id).getByRole("link")).toHaveCount(0);
        await expect(
          stepItem(page, id).locator('[aria-disabled="true"]'),
        ).toBeVisible();
      }
    }
    await expect(
      page.getByRole("navigation", { name: "Project views" }),
    ).toHaveCount(0);
  });

  test("reached questions and locations navigate with guided URLs and one current step", async ({
    page,
    gotoView,
    projectId,
  }) => {
    await seedReachedSteps(page, projectId);
    await gotoView("intake");
    // Later workspace steps require a completed brief and a real comparison;
    // a seeded progress marker alone cannot manufacture those prerequisites.
    for (const id of ["questions", "locations"] as FlowStep[]) {
      const link = stepItem(page, id).getByRole("link");
      await expect(link).toHaveAttribute("href", flowStepHref(projectId, id));
      await followLink(page, link, flowStepHref(projectId, id));
      await expectCurrentStep(page, id);
      await expect(
        page.getByRole("navigation", { name: "Project views" }),
      ).toHaveCount(0);
    }
  });

  test("back and forward restore the guided current step", async ({
    page,
    gotoView,
    projectId,
  }) => {
    await seedReachedSteps(page, projectId);
    await gotoView("intake");
    const trail: FlowStep[] = ["questions", "locations", "compare"];
    for (const id of trail.slice(1)) {
      await followLink(
        page,
        stepItem(page, id).getByRole("link"),
        flowStepHref(projectId, id),
      );
      await expectCurrentStep(page, id);
    }
    for (const id of trail.slice(0, -1).reverse()) {
      await page.goBack();
      await expect(page).toHaveURL(flowStepHref(projectId, id));
      await expectCurrentStep(page, id);
    }
    for (const id of trail.slice(1)) {
      await page.goForward();
      await expect(page).toHaveURL(flowStepHref(projectId, id));
      await expectCurrentStep(page, id);
    }
  });
});

test.describe("deep links", () => {
  for (const view of VIEW_ORDER) {
    test(`loading the ${view} URL directly renders that view`, async ({
      page,
      gotoView,
    }) => {
      await gotoView(view, view === "site" ? DEFAULT_SITE : undefined);
      await expect(
        page.getByRole("heading", { level: 1, name: views[view] }),
      ).toBeVisible();
      await expect(
        page.getByRole("region", {
          name: view === "map" ? "Candidate locations" : views[view],
          exact: true,
        }),
      ).toBeVisible();
      if (view === "intake") await expectCurrentStep(page, "questions");
      if (view === "workspace") await expectCurrentStep(page, "locations");
    });
  }

  for (const { id } of FLOW_STEPS.filter((step) => step.id !== "questions")) {
    test(`the ${id} deep link identifies its guided step without saved results`, async ({
      page,
      projectId,
    }) => {
      await page.goto(flowStepHref(projectId, id));
      await expectCurrentStep(page, id);
      await expect(
        stepItem(page, "questions").getByRole("link"),
      ).toHaveAttribute("href", flowStepHref(projectId, "questions"));
      await expect(
        page.getByRole("heading", { level: 1, name: "Workspace" }),
      ).toBeVisible();
    });
  }

  test("the printable plan keeps the flow stepper and comparison recovery link", async ({
    page,
    gotoView,
  }) => {
    await gotoView("plan");
    await expect(
      page.getByRole("heading", { level: 1, name: "Location plan" }),
    ).toBeVisible();
    await expect(progress(page)).toBeVisible();
    await expect(
      page.getByRole("navigation", { name: "Project views" }),
    ).toHaveCount(0);
    await expect(
      page.getByRole("link", { name: "Open the comparison" }),
    ).toBeVisible();
  });

  test("legacy map selection is preserved when opening the comparison", async ({
    page,
    gotoView,
    projectId,
  }) => {
    await gotoView("map");
    const row = page
      .getByRole("list", { name: "Candidate sites", exact: true })
      .getByRole("link", { name: /Heights storefront/ });
    await row.click();
    await expect(page).toHaveURL(workspaceHref(projectId, "map", "heights"));
    await expect(row).toHaveAttribute("aria-current", "true");
    await expandProjectNavigation(page);
    const comparisonLink = page
      .getByRole("navigation", { name: "Project views" })
      .getByRole("list", { name: "Tasks" })
      .getByRole("link", { name: "Comparison", exact: true });
    await followLink(
      page,
      comparisonLink,
      workspaceHref(projectId, "comparison", "heights"),
    );
    await expect(
      page.getByRole("heading", { level: 1, name: "Comparison" }),
    ).toBeVisible();
  });

  test("/sites/unselected asks for a selection and offers recovery", async ({
    page,
    gotoView,
    projectId,
  }) => {
    const problems = trackConsole(page);
    await gotoView("site");
    await expect(page).toHaveURL(/\/sites\/unselected$/);
    await expect(
      page.getByRole("heading", { level: 1, name: "Site detail" }),
    ).toBeVisible();
    await expect(
      page.getByText(/pick a site|select a site|choose a site/i),
    ).toBeVisible();
    await expect(
      page.getByRole("heading", { name: "Unable to load this project view" }),
    ).toHaveCount(0);
    await page.getByRole("link", { name: "Back to map" }).click();
    await expect(page).toHaveURL(workspaceHref(projectId, "map"));
    await expect(
      page.getByRole("link", { name: /Montrose storefront/ }),
    ).toBeVisible();
    expect(problems).toEqual([]);
  });
});

test.describe("bad input", () => {
  for (const view of VIEW_ORDER) {
    test(`an unknown projectId on the ${view} view shows a way back`, async ({
      page,
    }) => {
      await page.goto(
        workspaceHref(
          "no-such-project",
          view,
          view === "site" ? DEFAULT_SITE : undefined,
        ),
      );
      if (view === "map" || view === "site") {
        await expect(
          page.getByRole("heading", { level: 1, name: "Page not found" }),
        ).toBeVisible();
        return;
      }
      await expect(
        page.getByRole("heading", { level: 1, name: views[view] }),
      ).toBeVisible();
      await expect(
        page.getByRole("heading", { level: 2, name: "Project unavailable" }),
      ).toBeVisible();
      await expect(page.getByText(/\bat\s+\S+\s+\(.*:\d+:\d+\)/)).toHaveCount(
        0,
      );
      await page.getByRole("link", { name: "Open example project" }).click();
      await expect(page).toHaveURL(/\/projects\/houston-coffee\/intake$/);
    });
  }

  test("an unknown siteId returns a recoverable not-found page", async ({
    page,
    projectId,
  }) => {
    await page.goto(workspaceHref(projectId, "site", "no-such-site"));
    await expect(
      page.getByRole("heading", { level: 1, name: "Page not found" }),
    ).toBeVisible();
  });

  test("an unknown ?site= does not break the comparison", async ({
    page,
    gotoView,
  }) => {
    const problems = trackConsole(page);
    await gotoView("comparison", "no-such-site");
    await expect(
      page.getByRole("heading", { level: 1, name: "Comparison" }),
    ).toBeVisible();
    await expect(
      page.getByRole("table", { name: /^Comparison / }),
    ).toBeVisible();
    expect(problems).toEqual([]);
  });

  test("a repeated ?site= parameter does not break the map", async ({
    page,
    projectId,
  }) => {
    await page.goto(`/projects/${projectId}/map?site=heights&site=montrose`);
    await expect(
      page.getByRole("heading", { level: 1, name: "Map" }),
    ).toBeVisible();
    await expect(
      page.getByRole("link", { name: /Heights storefront/ }),
    ).toBeVisible();
  });

  for (const query of [
    "step=no-such-step",
    "step=questions",
    "step=compare&step=results",
  ]) {
    test(`workspace handles ${query}`, async ({ page, projectId }) => {
      await page.goto(`/projects/${projectId}/workspace?${query}`);
      await expectCurrentStep(
        page,
        query.startsWith("step=compare") ? "compare" : "locations",
      );
      await expect(
        page.getByRole("heading", { level: 1, name: "Workspace" }),
      ).toBeVisible();
    });
  }

  for (const path of [
    "/does-not-exist",
    "/projects/houston-coffee/does-not-exist",
    "/projects/houston-coffee/sites",
    "/projects/no-such-project/plan",
  ]) {
    test(`${path} returns 404`, async ({ page }) => {
      const response = await page.goto(path);
      expect(response?.status()).toBe(404);
      await expect(
        page.getByRole("heading", { level: 1, name: "Page not found" }),
      ).toBeVisible();
    });
  }
});

test.describe("responsive layout", () => {
  // HAC-130 is desktop-first; retain tablet/desktop workspace coverage, not phone-specific QA.
  for (const width of [375, 768, 1280]) {
    for (const view of ROUTES.filter(
      (route) => route !== "workspace" || width >= 768,
    )) {
      test(`${view} at ${width}px: navigation is reachable without horizontal scroll`, async ({
        page,
        gotoView,
      }) => {
        await page.setViewportSize({ width, height: 900 });
        await gotoView(view, view === "site" ? DEFAULT_SITE : undefined);
        await expect(
          page.getByRole("heading", { level: 1, name: viewHeading(view) }),
        ).toBeVisible();
        const guided = GUIDED_ROUTES.includes(view);
        if (!guided) await expandProjectNavigation(page);
        const nav = guided
          ? progress(page)
          : page.getByRole("navigation", { name: "Project views" });
        await expect(nav).toBeVisible();
        const { scrollWidth, innerWidth } = await page.evaluate(() => ({
          scrollWidth: document.documentElement.scrollWidth,
          innerWidth: window.innerWidth,
        }));
        expect(scrollWidth, "document width").toBeLessThanOrEqual(innerWidth);
        const items = guided
          ? nav.locator(
              "[data-flow-step] > a, [data-flow-step] > span[aria-disabled]",
            )
          : nav.getByRole("list", { name: "Tasks" }).getByRole("link");
        if (guided) await expect(items).toHaveCount(FLOW_STEPS.length);
        const boxes = [];
        for (const item of await items.all()) {
          await item.scrollIntoViewIfNeeded();
          await expect(item).toBeVisible();
          const box = await item.boundingBox();
          expect(box).not.toBeNull();
          expect(box!.x).toBeGreaterThanOrEqual(0);
          expect(box!.x + box!.width).toBeLessThanOrEqual(innerWidth);
          boxes.push(box!);
        }
        for (let i = 0; i < boxes.length; i++) {
          for (let j = i + 1; j < boxes.length; j++) {
            const a = boxes[i]!;
            const b = boxes[j]!;
            expect(
              a.x < b.x + b.width &&
                b.x < a.x + a.width &&
                a.y < b.y + b.height &&
                b.y < a.y + a.height,
              "navigation items overlap",
            ).toBe(false);
          }
        }
      });
    }
  }
});

test.describe("console", () => {
  for (const view of ROUTES) {
    test(`the ${view} view logs no errors, warnings or hydration problems`, async ({
      page,
      gotoView,
    }) => {
      const problems = trackConsole(page);
      await gotoView(view, view === "site" ? DEFAULT_SITE : undefined);
      await expect(
        page.getByRole("heading", { level: 1, name: viewHeading(view) }),
      ).toBeVisible();
      await page.waitForLoadState("networkidle");
      expect(problems).toEqual([]);
    });
  }

});
