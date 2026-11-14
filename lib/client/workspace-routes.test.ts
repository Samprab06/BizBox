import { expect, it } from "vitest";
import {
  nextStep,
  routeLabels,
  taskForRoute,
  views,
  workspaceHref,
  workspaceSteps,
  workspaceTasks,
  type WorkspaceRoute,
} from "./workspace-routes";

const allRoutes = [
  ...(Object.keys(views) as (keyof typeof views)[]),
  "plan",
] as WorkspaceRoute[];

it("groups the founder's work under three tasks", () => {
  expect(workspaceTasks.map((task) => task.label)).toEqual([
    "Find a location",
    "Test the plan",
    "Make the decision",
  ]);
  expect(
    workspaceTasks.map((task) => task.entries.map((entry) => entry.route)),
  ).toEqual([
    ["intake", "map", "site"],
    ["comparison", "replay", "simulator"],
    ["plan"],
  ]);
});

it("lists every existing route exactly once, with its own label", () => {
  expect(workspaceSteps.map((step) => step.route).sort()).toEqual(
    [...allRoutes].sort(),
  );
  for (const task of workspaceTasks) {
    for (const entry of task.entries)
      expect(entry.label).toBe(routeLabels[entry.route]);
  }
});

it("keeps every URL unchanged", () => {
  expect(workspaceHref("p", "intake")).toBe("/projects/p/intake");
  expect(workspaceHref("p", "map", "a")).toBe("/projects/p/map?site=a");
  expect(workspaceHref("p", "site", "a")).toBe("/projects/p/sites/a");
  expect(workspaceHref("p", "site")).toBe("/projects/p/sites/unselected");
  expect(workspaceHref("p", "comparison", "a")).toBe(
    "/projects/p/comparison?site=a",
  );
  expect(workspaceHref("p", "replay", "a")).toBe("/projects/p/replay?site=a");
  expect(workspaceHref("p", "plan", "a")).toBe("/projects/p/plan");
});

it("keeps planned screens out of the linked entries", () => {
  const planned = workspaceTasks.flatMap((task) =>
    task.planned.map((entry) => entry.id),
  );
  expect(planned).toEqual(["sensitivity", "findings"]);
  const linked: string[] = workspaceSteps.map((step) => step.route);
  for (const id of planned) expect(linked).not.toContain(id);
});

it("finds the task for a route", () => {
  expect(taskForRoute("site").id).toBe("find");
  expect(taskForRoute("replay").id).toBe("test");
  expect(taskForRoute("plan").id).toBe("decide");
});

it("names the next step, crossing from one task to the next", () => {
  expect(nextStep("intake")?.route).toBe("map");
  expect(nextStep("site")).toMatchObject({
    route: "comparison",
    step: "compare your shortlist",
  });
  expect(nextStep("replay")?.route).toBe("simulator");
  expect(nextStep("simulator")?.route).toBe("plan");
  expect(nextStep("plan")).toBeUndefined();
});
