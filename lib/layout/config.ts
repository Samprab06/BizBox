import type { Layout } from "@/lib/contracts/layout";
import {
  SiteConfigSchema,
  type SiteConfig,
  type SiteConfigInput,
} from "@/lib/sim/contracts";
import { deriveSimParams, LayoutInputError } from "./model";

/** Explicitly selected layout is the capacity source; other business inputs remain unchanged. */
export function applyLayoutToConfig(
  layout: Layout,
  config: SiteConfigInput,
  options: { plannedStationsOverride?: number } = {},
): SiteConfig {
  const params = deriveSimParams(layout);
  if (
    options.plannedStationsOverride !== undefined &&
    options.plannedStationsOverride !== params.stationCount
  ) {
    throw new LayoutInputError({
      "scenario.overrides.plannedStations": [
        "Explicit station override conflicts with the selected layout; edit the layout or remove the override",
      ],
    });
  }
  const parsed = SiteConfigSchema.safeParse({
    ...config,
    stations: {
      planned: params.stationCount,
      usableSf: params.usableSf,
      sfPerStation: params.sfPerStation,
    },
    queueCapacity: params.queueCapacity,
  });
  if (!parsed.success) {
    const errors: Record<string, string[]> = {};
    for (const issue of parsed.error.issues)
      (errors[["config", ...issue.path].join(".")] ??= []).push(issue.message);
    throw new LayoutInputError(errors);
  }
  return parsed.data;
}
