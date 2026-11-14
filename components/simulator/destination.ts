import { DEMO_PROJECT_ID } from "@/lib/projects/ids";

export type SimulatorSearch = Record<string, string | string[] | undefined>;

/** Preserve comparison, site, run and future replay parameters on legacy links. */
export function simulatorDestination(search: SimulatorSearch) {
  const project =
    typeof search.project === "string" &&
    search.project.length > 0 &&
    search.project.length <= 300
      ? search.project
      : DEMO_PROJECT_ID;
  const query = new URLSearchParams();
  for (const [key, value] of Object.entries(search)) {
    for (const item of Array.isArray(value)
      ? value
      : value === undefined
        ? []
        : [value])
      query.append(key, item);
  }
  return `/projects/${encodeURIComponent(project)}/simulator${query.size ? `?${query}` : ""}`;
}
