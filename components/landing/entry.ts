/**
 * HAC-129: where the BizBox landing sends a visitor. The landing keeps no state of its own:
 * "has this visitor started?" is answered from the existing intake session (the same
 * localStorage record IntakeScreen, the workspace assistant and the context bar share).
 */
import { missingFields, type IntakeSession } from "@/components/intake/profile";
import { workspaceHref } from "@/lib/client/workspace-routes";

/** The example project the landing opens. */
export const ENTRY_PROJECT_ID = "houston-coffee";

export type EntryTarget =
  | { kind: "onboarding"; href: string }
  | {
      kind: "returning";
      complete: boolean;
      onboardingHref: string;
      workspaceHref: string;
    };

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
  projectId = ENTRY_PROJECT_ID,
): EntryTarget {
  // The guided onboarding is the intake view's default (HAC-127).
  const onboardingHref = workspaceHref(projectId, "intake");
  if (!session || !hasStarted(session))
    return { kind: "onboarding", href: onboardingHref };
  return {
    kind: "returning",
    complete: missingFields(session.profile).length === 0,
    onboardingHref,
    workspaceHref: workspaceHref(projectId, "workspace"),
  };
}
