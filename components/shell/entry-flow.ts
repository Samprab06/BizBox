/**
 * HAC-150: the pure rules of the chat-first entry. The project's entry route
 * (`/projects/<id>`) opens the consultant full screen (`focus`); once the brief is complete
 * or the agent's first `navigate` action arrives, the shell docks it beside a step view.
 */
import { missingFields, type Profile } from "@/components/intake/profile";
import {
  isRulerStep,
  resumeStep,
  type QuestionStep,
  type RulerStep,
} from "@/components/onboarding/flow";
import type { UiAction } from "@/lib/contracts/agent";
import { workspaceHref, type WorkspaceRoute } from "@/lib/client/workspace-routes";

/** The route the founder lands on once docked: the workspace screen with the selected space. */
export const SPACES_ROUTE = "workspace" as const satisfies WorkspaceRoute;

export const spacesHref = (projectId: string) =>
  workspaceHref(projectId, SPACES_ROUTE);

export const entryPath = (projectId: string) =>
  `/projects/${encodeURIComponent(projectId)}`;

/** True only for the project's entry route itself, not for any step under it. */
export function isEntryPath(pathname: string, projectId: string): boolean {
  return pathname.replace(/\/+$/, "") === entryPath(projectId);
}

/** The brief is complete when no intake field is missing (the `missingFields` rule). */
export const isBriefComplete = (profile: Profile | undefined): boolean =>
  profile !== undefined && missingFields(profile).length === 0;

export type AnswerCardStep =
  | { kind: "choice"; step: "category" | "city" | "price" }
  | { kind: "ruler"; step: RulerStep };

/**
 * The inline answer card to show: the first question still open, when it is one the
 * guided onboarding answers with chips or a ruler. Free-text questions (concept,
 * customers, areas, hours, must-haves) are answered by typing in the chat.
 */
export function answerCardStep(profile: Profile): AnswerCardStep | null {
  const step = resumeStep(profile);
  if (step === "review") return null;
  return cardForStep(step);
}

export function cardForStep(step: QuestionStep): AnswerCardStep | null {
  if (step === "category" || step === "city" || step === "price")
    return { kind: "choice", step };
  if (isRulerStep(step)) return { kind: "ruler", step };
  return null;
}

/** The first `navigate` action of a reply, if any. */
export function firstNavigate(
  actions: readonly UiAction[],
): Extract<UiAction, { type: "navigate" }> | undefined {
  return actions.find(
    (action): action is Extract<UiAction, { type: "navigate" }> =>
      action.type === "navigate",
  );
}

/**
 * Where a `navigate` action goes. A stage that needs a space (the site detail, the
 * interior) without one falls back to Spaces rather than to a broken URL.
 */
export function navigateHref(
  projectId: string,
  action: Extract<UiAction, { type: "navigate" }>,
): string {
  const { stage, siteId, comparisonId } = action;
  if (stage === "site" || stage === "interior")
    return siteId
      ? workspaceHref(projectId, "site", siteId)
      : spacesHref(projectId);
  return workspaceHref(projectId, stage, siteId, comparisonId ?? null);
}
