import AxeBuilder from "@axe-core/playwright";
import { test as base, expect, type Page } from "@playwright/test";
import {
  workspaceHref,
  routeLabels,
  type WorkspaceRoute,
} from "../../lib/client/workspace-routes";

export const viewHeading = (view: WorkspaceRoute) =>
  view === "simulator" ? "Simulator" : routeLabels[view];

export const PROJECT_ID = "houston-coffee";

/** Site ids that exist in the example project (lib/workspace-preview.ts). */
export const SITE_IDS = ["montrose", "heights"] as const;

type Fixtures = {
  projectId: string;
  /** Opens a workspace view; `siteId` selects a site (the "site" view needs one). */
  gotoView: (view: WorkspaceRoute, siteId?: string) => Promise<void>;
  /** Removes every saved intake session from localStorage, for a clean start. */
  clearIntakeStorage: () => Promise<void>;
};

export const test = base.extend<Fixtures>({
  projectId: PROJECT_ID,
  gotoView: async ({ page, projectId }, provide) => {
    await provide(async (view, siteId) => {
      await page.goto(workspaceHref(projectId, view, siteId));
    });
  },
  clearIntakeStorage: async ({ page, projectId }, provide) => {
    await provide(async () => {
      // localStorage is per-origin, so load a page from the app first.
      if (page.url() === "about:blank")
        await page.goto(workspaceHref(projectId, "intake"));
      await page.evaluate(() => {
        for (const key of Object.keys(localStorage)) {
          if (key.startsWith("sitework:intake:")) localStorage.removeItem(key);
        }
      });
    });
  },
});

export { expect };

/** Fails the test on serious or critical accessibility violations. */
export async function expectNoA11yViolations(page: Page) {
  const { violations } = await new AxeBuilder({ page }).analyze();
  const blocking = violations.filter(
    (v) => v.impact === "serious" || v.impact === "critical",
  );
  expect(
    blocking.map(
      (v) => `${v.id} (${v.impact}): ${v.help} [${v.nodes.length} node(s)]`,
    ),
    "serious or critical accessibility violations",
  ).toEqual([]);
}

/** Navigation checks explicitly open the decision page's native task disclosure. */
export async function expandProjectNavigation(page: Page) {
  const disclosure = page
    .getByRole("navigation", { name: "Project views", exact: true })
    .locator("details");
  if (
    (await disclosure.count()) &&
    (await disclosure.getAttribute("open")) === null
  )
    await disclosure.locator("summary").click();
}
