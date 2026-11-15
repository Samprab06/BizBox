import { redirect } from "next/navigation";
import { flowStepHref } from "@/lib/client/flow-steps";

/** Scene 1: the project's entry route opens the flow's first step, the questionnaire. */
export default async function ProjectEntryPage({
  params,
}: {
  params: Promise<{ projectId: string }>;
}) {
  const { projectId } = await params;
  redirect(flowStepHref(projectId, "questions"));
}
