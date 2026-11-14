import { z } from "zod";
import { EvaluationResultSchema } from "@/lib/contracts/evaluation";

const referenceSchema = z.object({
  projectId: z.string(),
  comparisonId: z.string().min(1),
  profileId: z.string().min(1),
  profileVersion: z.number().int().positive(),
});
export type InsightsReference = z.infer<typeof referenceSchema>;
const payloadSchema = z.object({
  comparisonId: z.string().min(1),
  outdated: z.boolean(),
  result: EvaluationResultSchema,
  comparison: z
    .object({
      synthetic: z.boolean(),
      id: z.string().optional(),
      projectId: z.string().optional(),
      profileId: z.string().optional(),
    })
    .optional(),
});

/** This reader never imports the server fixture builder or simulation engine. */
export function insightsReference(
  href: string,
  saved: string | null,
  projectId: string,
) {
  let reference: InsightsReference | null = null;
  try {
    const parsed = referenceSchema.safeParse(JSON.parse(saved ?? "null"));
    if (parsed.success && parsed.data.projectId === projectId)
      reference = parsed.data;
  } catch {
    // A malformed local reference does not invalidate an explicit permalink.
  }
  const ids = new URL(href).searchParams.getAll("comparison");
  const comparisonId =
    ids.length === 0
      ? reference?.comparisonId
      : ids.length === 1 && ids[0]
        ? ids[0]
        : undefined;
  return {
    comparisonId,
    reference: reference?.comparisonId === comparisonId ? reference : null,
  };
}

export function parseStoredInsights(
  raw: unknown,
  identity: {
    projectId: string;
    comparisonId: string;
    siteId: string;
    reference?: InsightsReference | null;
  },
) {
  const payload = payloadSchema.parse(raw);
  const { result } = payload;
  if (
    payload.comparisonId !== identity.comparisonId ||
    result.projectId !== identity.projectId ||
    (payload.comparison?.id !== undefined &&
      payload.comparison.id !== identity.comparisonId) ||
    (payload.comparison?.projectId !== undefined &&
      payload.comparison.projectId !== identity.projectId) ||
    (payload.comparison?.profileId !== undefined &&
      payload.comparison.profileId !== result.profileId) ||
    (identity.reference &&
      (result.profileId !== identity.reference.profileId ||
        result.profileVersion !== identity.reference.profileVersion))
  )
    throw new Error("Saved comparison identity does not match this selection.");
  const sites = result.sites.filter((site) => site.siteId === identity.siteId);
  if (sites.length !== 1)
    throw new Error("The selected site is not in this saved comparison.");
  const insights = sites[0].insights;
  if (
    insights &&
    (insights.seedCount !== result.seeds.length ||
      (payload.comparison &&
        insights.synthetic !== payload.comparison.synthetic))
  )
    throw new Error(
      "Retained insights do not match the saved scenario source.",
    );
  return { payload, site: sites[0] };
}
