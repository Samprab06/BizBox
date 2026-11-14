import {
  StationExperimentRunSchema,
  type StationExperimentRun,
  type StationExperimentConfigurationId,
} from "@/lib/contracts/station-experiment-run";

export type StationSelection = Pick<
  StationExperimentRun["source"],
  "projectId" | "comparisonId" | "siteId"
> &
  Partial<
    Pick<
      StationExperimentRun["source"],
      "profileId" | "profileVersion" | "seeds" | "dayType" | "synthetic"
    >
  > & { modelVersion?: string };
const sameSeeds = (a: readonly number[], b: readonly number[]) =>
  JSON.stringify([...a].sort((x, y) => x - y)) ===
  JSON.stringify([...b].sort((x, y) => x - y));
export function parseStationRun(raw: unknown, expected: StationSelection) {
  const plan = StationExperimentRunSchema.parse(raw),
    s = plan.source;
  if (
    s.projectId !== expected.projectId ||
    s.comparisonId !== expected.comparisonId ||
    s.siteId !== expected.siteId ||
    s.dayType !== (expected.dayType ?? "weekday") ||
    (expected.profileId !== undefined && s.profileId !== expected.profileId) ||
    (expected.profileVersion !== undefined &&
      s.profileVersion !== expected.profileVersion) ||
    (expected.synthetic !== undefined && s.synthetic !== expected.synthetic) ||
    (expected.seeds && !sameSeeds(expected.seeds, s.seeds)) ||
    s.seedCount !== s.seeds.length ||
    new Set(s.seeds).size !== s.seeds.length
  )
    throw new Error(
      "Station experiment source does not match the selected saved scenario.",
    );
  if (
    new Set(plan.configurations.map((c) => c.id)).size !==
      plan.configurations.length ||
    (plan.nextConfigurationId &&
      !plan.configurations.some((c) => c.id === plan.nextConfigurationId))
  )
    throw new Error("Station configuration identity is invalid.");
  if (
    (plan.status === "needs_confirmation" &&
      (!plan.confirmation ||
        plan.confirmation.configurationId !== plan.nextConfigurationId)) ||
    (plan.status !== "unavailable" &&
      !plan.configurations.some((c) => c.id === "baseline")) ||
    (plan.status === "ready" &&
      (plan.result?.status !== "available" ||
        plan.nextConfigurationId !== null ||
        plan.configurations.some((c) => c.status !== "succeeded")))
  )
    throw new Error("Station progress or confirmation could not be verified.");
  const result = plan.result;
  if (result?.status === "available") {
    const i = result.identity;
    if (
      i.projectId !== s.projectId ||
      i.siteId !== s.siteId ||
      i.profileId !== s.profileId ||
      i.profileVersion !== s.profileVersion ||
      i.synthetic !== s.synthetic ||
      (expected.modelVersion !== undefined &&
        i.modelVersion !== expected.modelVersion) ||
      !sameSeeds(i.seeds, s.seeds) ||
      i.baselineComparisonId !==
        plan.configurations.find((c) => c.id === "baseline")?.comparisonId ||
      JSON.stringify([...i.alternativeComparisonIds].sort()) !==
        JSON.stringify(
          plan.configurations
            .filter((c) => c.id !== "baseline" && c.comparisonId)
            .map((c) => c.comparisonId!)
            .sort(),
        ) ||
      result.variants.some(
        (v) =>
          v.siteId !== s.siteId ||
          v.dayType !== s.dayType ||
          !sameSeeds(v.source.seeds, s.seeds) ||
          v.source.seedCount !== s.seedCount,
      ) ||
      (result.selected &&
        (!result.variants.some(
          (v) => JSON.stringify(v) === JSON.stringify(result.selected),
        ) ||
          result.selected.siteId !== s.siteId ||
          result.selected.dayType !== s.dayType ||
          !sameSeeds(result.selected.source.seeds, s.seeds)))
    )
      throw new Error("Station result does not match its evaluated baseline.");
  }
  return plan;
}

/** A response deadline does not abort, refund or automatically retry reserved work. */
export async function boundedStationWrite<T>(work: Promise<T>): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      work,
      new Promise<never>((_, reject) => {
        timer = setTimeout(
          () =>
            reject(
              new Error(
                "Station request status is unknown after the response deadline.",
              ),
            ),
          70000,
        );
      }),
    ]);
  } finally {
    if (timer !== undefined) clearTimeout(timer);
  }
}

/** A single explicit click may finish planned configurations; partial work always stops. */
export async function runStationBatch(
  initial: StationExperimentRun,
  options: {
    request: (input: {
      configurationId: StationExperimentConfigurationId;
      confirm: boolean;
    }) => Promise<StationExperimentRun>;
    onUpdate: (value: StationExperimentRun) => void;
    isCurrent: () => boolean;
    confirm?: boolean;
  },
) {
  let plan = initial;
  const confirmed = options.confirm
    ? initial.confirmation?.configurationId
    : undefined;
  if (initial.status === "needs_confirmation" && !confirmed) return initial;
  for (let step = 0; step < 3 && options.isCurrent(); step++) {
    const id = plan.nextConfigurationId;
    if (!id || plan.status === "ready" || plan.status === "unavailable")
      return plan;
    plan = await options.request({
      configurationId: id,
      confirm: id === confirmed,
    });
    if (!options.isCurrent()) return;
    options.onUpdate(plan);
    if (
      plan.status === "needs_confirmation" ||
      plan.status === "ready" ||
      plan.status === "unavailable"
    )
      return plan;
    const completed =
      plan.configurations.find((c) => c.id === id)?.status === "succeeded";
    const next = plan.configurations.find(
      (c) => c.id === plan.nextConfigurationId,
    );
    if (!completed || !next || next.status !== "planned") return plan;
  }
  return plan;
}
