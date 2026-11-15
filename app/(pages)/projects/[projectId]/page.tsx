import { redirect } from "next/navigation";
import { workspaceHref } from "@/lib/client/workspace-routes";

/**
 * Scene 1: the project's entry route opens the flow's first step, the questionnaire. The
 * path is `flowStepHref(projectId, "questions")`; that helper lives in a client module, so
 * this server page builds the same `/intake` URL with `workspaceHref`.
 */
export default async function ProjectEntryPage({
  params,
}: {
  params: Promise<{ projectId: string }>;
}) {
  const { projectId } = await params;
  redirect(workspaceHref(projectId, "intake"));
}
