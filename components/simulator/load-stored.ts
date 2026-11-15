import type { SiteInsights } from "@/lib/contracts/insights";
import type { ComparisonStore, StoredEvaluation } from "@/lib/evaluation/store";
import { parseStoredInsights } from "@/components/insights/stored-insights";
import { storedSimulator } from "./stored";

export type SimulatorLoadIssue =
  "read" | "stored_data" | "freshness" | "insights";
type StoredSimulatorView = NonNullable<ReturnType<typeof storedSimulator>> & {
  synthetic: boolean;
  robustness: StoredEvaluation["robustness"] | null;
  insights?: SiteInsights;
  insightsUnavailableReason?: string;
  profileVersion: number;
  profileVersionUnknown: boolean;
  outdated: boolean;
};
export type SimulatorLoadResult =
  | { kind: "example" }
  | { kind: "stored"; comparisonId: string; value: StoredSimulatorView }
  | { kind: "not_found" }
  | { kind: "error" };

/** Keep the existing bounded single-value query interpretation for comparison/site IDs. */
export const simulatorSearchValue = (value: unknown) =>
  typeof value === "string" && value.length <= 300 ? value : undefined;

/** Enumerated stages only: never a database error, identifier, URL or stored payload. */
export function logSimulatorLoadIssue(stage: SimulatorLoadIssue) {
  console.warn(JSON.stringify({ event: "simulator_load_issue", stage }));
}

/** SDK-free orchestration over the existing scoped store and recorded-run conversion. */
export async function loadStoredSimulator(
  input: { projectId: string; comparison?: unknown; siteId?: unknown },
  dependencies: {
    createStore: () => Pick<ComparisonStore, "load" | "currentProfileVersion">;
    diagnose?: (issue: SimulatorLoadIssue) => void;
  },
): Promise<SimulatorLoadResult> {
  if (input.comparison === undefined) return { kind: "example" };
  const comparisonId = simulatorSearchValue(input.comparison);
  if (!comparisonId?.trim()) return { kind: "not_found" };
  const diagnose = dependencies.diagnose ?? logSimulatorLoadIssue;
  let stage: SimulatorLoadIssue = "read";
  try {
    const store = dependencies.createStore();
    const stored = await store.load(input.projectId, comparisonId);
    if (!stored) return { kind: "not_found" };
    stage = "stored_data";
    const currentProfileVersion = await store
      .currentProfileVersion(input.projectId)
      .catch(() => {
        diagnose("freshness");
        return null;
      });
    const siteId = simulatorSearchValue(input.siteId);
    const simulator = storedSimulator({
      comparisonId: stored.id,
      request: stored.evaluation.request,
      result: stored.evaluation.result,
      runs: stored.runs,
      ...(stored.evaluation.assembly
        ? { assembly: stored.evaluation.assembly }
        : {}),
      ...(siteId ? { siteId } : {}),
    });
    if (!simulator) {
      diagnose("stored_data");
      return { kind: "error" };
    }
    let insights: SiteInsights | undefined;
    let insightsUnavailableReason: string | undefined;
    try {
      insights = parseStoredInsights(
        {
          comparisonId: stored.id,
          outdated: false,
          result: stored.evaluation.result,
          comparison: stored.comparison,
        },
        {
          projectId: input.projectId,
          comparisonId: stored.id,
          siteId: simulator.data[0].run.siteId,
        },
      ).site.insights;
    } catch {
      // Keep the existing valid scene when optional retained insights cannot be verified.
      diagnose("insights");
      insightsUnavailableReason =
        "Retained insights could not be verified for this selected saved site and scenario.";
    }
    return {
      kind: "stored",
      comparisonId,
      value: {
        ...simulator,
        synthetic: stored.comparison.synthetic,
        robustness: stored.evaluation.robustness ?? null,
        insights,
        insightsUnavailableReason,
        profileVersion: stored.evaluation.result.profileVersion,
        profileVersionUnknown: currentProfileVersion === null,
        outdated:
          currentProfileVersion !== null &&
          currentProfileVersion !== stored.evaluation.result.profileVersion,
      },
    };
  } catch {
    diagnose(stage);
    return { kind: "error" };
  }
}
