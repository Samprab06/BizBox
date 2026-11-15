/**
 * The project's entry route and the brief-complete rule. Scene 1 removed the full-screen
 * chat entry (HAC-150): `/projects/<id>` now leads to the questionnaire, and the consultant
 * lives only in the workspace dock. The landing still links founders to `entryPath`.
 */
import { missingFields, type Profile } from "@/components/intake/profile";

export const entryPath = (projectId: string) =>
  `/projects/${encodeURIComponent(projectId)}`;

/** The brief is complete when no intake field is missing (the `missingFields` rule). */
export const isBriefComplete = (profile: Profile | undefined): boolean =>
  profile !== undefined && missingFields(profile).length === 0;
