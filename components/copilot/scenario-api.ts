import { z } from "zod";

/**
 * HAC-84: the dock's calls to the existing scenario routes (HAC-80). No new routes:
 * Revert appends a new version through `POST .../scenarios/:id/revert-to`, and the
 * switcher reads the tree from `GET .../scenarios`.
 */

const ScenarioSummarySchema = z.object({
  id: z.string().min(1),
  parentId: z.string().min(1).nullable(),
  label: z.string(),
  author: z.enum(["founder", "agent"]),
  createdAt: z.string(),
});
export type ScenarioSummary = z.infer<typeof ScenarioSummarySchema>;

const TreeResponseSchema = z.object({
  tree: z.array(
    z.object({
      scenario: ScenarioSummarySchema,
      children: z.array(z.string()),
    }),
  ),
});
const ScenarioResponseSchema = z.object({
  scenario: z.object({ id: z.string().min(1) }),
});
const ErrorResponseSchema = z.object({ message: z.string() });

export class ScenarioApiError extends Error {
  constructor(
    message: string,
    readonly status: number,
  ) {
    super(message);
    this.name = "ScenarioApiError";
  }
}

const base = (projectId: string) =>
  `/api/projects/${encodeURIComponent(projectId)}/scenarios`;

async function failure(response: Response, fallback: string) {
  const body = ErrorResponseSchema.safeParse(
    await response.json().catch(() => null),
  );
  return new ScenarioApiError(
    body.success ? body.data.message : fallback,
    response.status,
  );
}

export type ScenarioApi = {
  list(projectId: string, signal?: AbortSignal): Promise<ScenarioSummary[]>;
  revert(input: {
    projectId: string;
    scenarioId: string;
    targetId: string;
  }): Promise<{ id: string }>;
};

export function createScenarioApi(fetcher: typeof fetch = fetch): ScenarioApi {
  return {
    async list(projectId, signal) {
      const response = await fetcher(base(projectId), {
        signal,
        cache: "no-store",
      });
      if (!response.ok)
        throw await failure(response, "Scenarios are unavailable right now.");
      const parsed = TreeResponseSchema.parse(await response.json());
      return parsed.tree.map((node) => node.scenario);
    },
    async revert({ projectId, scenarioId, targetId }) {
      const response = await fetcher(
        `${base(projectId)}/${encodeURIComponent(scenarioId)}/revert-to`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            targetId,
            author: "founder",
            rationale: "Reverted from the copilot dock",
          }),
        },
      );
      if (!response.ok)
        throw await failure(response, "The revert could not be saved.");
      return ScenarioResponseSchema.parse(await response.json()).scenario;
    },
  };
}

/** Root first, then each scenario's children in creation order, with their depth. */
export function orderScenarioTree(
  scenarios: ScenarioSummary[],
): { scenario: ScenarioSummary; depth: number }[] {
  const ids = new Set(scenarios.map((s) => s.id));
  const byParent = new Map<string | null, ScenarioSummary[]>();
  for (const scenario of scenarios) {
    const parent =
      scenario.parentId && ids.has(scenario.parentId)
        ? scenario.parentId
        : null;
    byParent.set(parent, [...(byParent.get(parent) ?? []), scenario]);
  }
  for (const list of byParent.values())
    list.sort((a, b) => a.createdAt.localeCompare(b.createdAt));
  const out: { scenario: ScenarioSummary; depth: number }[] = [];
  const seen = new Set<string>();
  const walk = (parent: string | null, depth: number) => {
    for (const scenario of byParent.get(parent) ?? []) {
      if (seen.has(scenario.id)) continue;
      seen.add(scenario.id);
      out.push({ scenario, depth });
      walk(scenario.id, depth + 1);
    }
  };
  walk(null, 0);
  return out;
}
