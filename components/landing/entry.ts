/**
 * HAC-129: where the BizBox landing sends a visitor. "Has this visitor started?" is answered
 * from the existing intake session (the same localStorage record IntakeScreen, the workspace
 * assistant and the context bar share).
 *
 * HAC-136: a first visit gets its own project (`POST /api/projects`); the landing remembers
 * that project's ID on this device so a returning founder resumes their own brief.
 */
import { missingFields, type IntakeSession } from "@/components/intake/profile";
import { entryPath } from "@/components/shell/entry-flow";
import { workspaceHref } from "@/lib/client/workspace-routes";
import { DEMO_PROJECT_ID, isKnownProjectId } from "@/lib/projects/ids";

/** localStorage key holding the ID of the project this device's founder is working on. */
export const CURRENT_PROJECT_KEY = "bizbox:current-project:v1";

export type EntryTarget =
  | { kind: "onboarding"; href: string }
  | {
      kind: "returning";
      complete: boolean;
      /** The project's chat-first entry (HAC-150); a complete brief docks from there. */
      onboardingHref: string;
      /** The guided intake, kept as the "Edit brief" view. */
      briefHref: string;
      workspaceHref: string;
    };

/** What /start does: open an existing project, or create one for a first visit. */
export type EntryPlan =
  { kind: "create" } | (EntryTarget & { projectId: string });

/** A session counts as started once the founder has answered or said something. */
export function hasStarted(session: IntakeSession | null): boolean {
  if (!session) return false;
  return (
    Object.values(session.profile).some(
      (answer) => answer?.origin === "founder",
    ) || session.messages.some((message) => message.role === "founder")
  );
}

export function entryTarget(
  session: IntakeSession | null,
  projectId: string,
): EntryTarget {
  // HAC-150: the chat-first entry is where the brief is taken; the guided intake (HAC-127)
  // remains as the "Edit brief" view.
  const onboardingHref = entryPath(projectId);
  if (!session || !hasStarted(session))
    return { kind: "onboarding", href: onboardingHref };
  return {
    kind: "returning",
    complete: missingFields(session.profile).length === 0,
    onboardingHref,
    briefHref: workspaceHref(projectId, "intake"),
    workspaceHref: workspaceHref(projectId, "workspace"),
  };
}

/**
 * The remembered project wins. Without one, a brief already started on the demo project
 * (saved before HAC-136) is resumed rather than abandoned; otherwise a new project is made.
 */
export function entryPlan(
  currentProjectId: string | null,
  readSession: (projectId: string) => IntakeSession | null,
): EntryPlan {
  const projectId =
    currentProjectId && isKnownProjectId(currentProjectId)
      ? currentProjectId
      : hasStarted(readSession(DEMO_PROJECT_ID))
        ? DEMO_PROJECT_ID
        : null;
  if (!projectId) return { kind: "create" };
  return { ...entryTarget(readSession(projectId), projectId), projectId };
}
