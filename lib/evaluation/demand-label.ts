import type {
  EvaluationResult,
  SiteEvaluation,
} from "@/lib/contracts/evaluation";

/**
 * The note shown next to a site when Jev was asked for but Huff produced its numbers (HAC-101),
 * for example "Huff (Jev failed for 3 of 64 personas)". Null when nothing needs saying: Huff was
 * the request, or Jev did answer.
 */
export function siteDemandLabel(
  result: Pick<EvaluationResult, "requestedDemandSource" | "demandSource">,
  site: Pick<SiteEvaluation, "jevPanel">,
  allSites: readonly Pick<SiteEvaluation, "jevPanel">[] = [],
): string | null {
  if (result.requestedDemandSource !== "jev" || result.demandSource !== "huff")
    return null;
  const panel = site.jevPanel;
  if (panel && panel.failedPersonaCount > 0)
    return `Huff (Jev failed for ${panel.failedPersonaCount} of ${panel.personaCount} personas)`;
  if (allSites.some((s) => (s.jevPanel?.failedPersonaCount ?? 0) > 0))
    return "Huff (Jev answered every persona here, but another site's panel was incomplete)";
  return "Huff (Jev unavailable)";
}
