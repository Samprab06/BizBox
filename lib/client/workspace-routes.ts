/** Screens rendered by `WorkspaceView`; each has a stable URL under `/projects/<id>/`. */
export const views = {
  intake: "Intake",
  map: "Map",
  site: "Site detail",
  comparison: "Comparison",
  replay: "Replay",
};

export type View = keyof typeof views;

/** Every workspace URL that exists today: the views plus the printable plan (`/plan`). */
export type WorkspaceRoute = View | "plan";

export const routeLabels: Record<WorkspaceRoute, string> = {
  ...views,
  plan: "Location plan",
};

export function workspaceHref(projectId: string, view: WorkspaceRoute, siteId?: string) {
  const base = `/projects/${encodeURIComponent(projectId)}`;
  if (view === "site") return `${base}/sites/${encodeURIComponent(siteId ?? "unselected")}`;
  if (view === "plan") return `${base}/plan`;
  return `${base}/${view}${siteId ? `?site=${encodeURIComponent(siteId)}` : ""}`;
}

export type TaskId = "find" | "test" | "decide";

/** A screen that exists and is linked from the navigation. */
export type AvailableEntry = {
  route: WorkspaceRoute;
  label: string;
  /** What the founder does here; it finishes "Next: ..." when this entry follows the current one. */
  step: string;
};

/**
 * A screen that is designed but not built yet. The navigation skips it, so no placeholder
 * route exists. To switch one on, add its route to `WorkspaceRoute`, give it a `step`, and
 * move it into `entries` at the position it should appear.
 */
export type PlannedEntry = {
  id: string;
  label: string;
  /** The ticket that builds it, when one is known. */
  ticket?: string;
};

export type WorkspaceTask = {
  id: TaskId;
  label: string;
  entries: AvailableEntry[];
  planned: PlannedEntry[];
};

/** The founder's three tasks and the screens under each. This is the only place the grouping is defined. */
export const workspaceTasks: readonly WorkspaceTask[] = [
  {
    id: "find",
    label: "Find a location",
    entries: [
      { route: "intake", label: views.intake, step: "describe your business" },
      { route: "map", label: views.map, step: "browse candidate spaces" },
      { route: "site", label: views.site, step: "inspect a space" },
    ],
    planned: [],
  },
  {
    id: "test",
    label: "Test the plan",
    entries: [
      { route: "comparison", label: views.comparison, step: "compare your shortlist" },
      { route: "replay", label: views.replay, step: "replay a day at the space" },
    ],
    planned: [
      { id: "sensitivity", label: "Sensitivity" },
      { id: "simulator", label: "City simulator", ticket: "SIM-6" },
    ],
  },
  {
    id: "decide",
    label: "Make the decision",
    entries: [{ route: "plan", label: routeLabels.plan, step: "build your location plan" }],
    planned: [{ id: "findings", label: "Findings" }],
  },
];

/** Available entries in the order a founder moves through them. */
export const workspaceSteps: readonly (AvailableEntry & { task: WorkspaceTask })[] = workspaceTasks.flatMap(
  (task) => task.entries.map((entry) => ({ ...entry, task })),
);

export function taskForRoute(route: WorkspaceRoute): WorkspaceTask {
  return workspaceSteps.find((step) => step.route === route)!.task;
}

/** The step that follows `route`, or `undefined` after the last one. */
export function nextStep(route: WorkspaceRoute): AvailableEntry | undefined {
  const index = workspaceSteps.findIndex((step) => step.route === route);
  return index < 0 ? undefined : workspaceSteps[index + 1];
}
