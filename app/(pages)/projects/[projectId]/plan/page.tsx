import { notFound } from "next/navigation";
import { PlanExport } from "@/components/plan/plan-export";
import { TaskNav } from "@/components/shell/task-nav";
import { getPreviewProject } from "@/lib/workspace-preview";

/** HAC-26: printable location plan for a saved comparison (?comparison=<id>[&investigation=<id>]). */
export default async function PlanPage({
  params,
  searchParams,
}: {
  params: Promise<{ projectId: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const [{ projectId }, { comparison, investigation }] = await Promise.all([
    params,
    searchParams,
  ]);
  const project = getPreviewProject(projectId);
  if (!project) notFound();
  return (
    <div className="print:text-black">
      <TaskNav projectId={projectId} route="plan" siteId={project.sites[0]?.id} />
      <h1 className="my-10 text-4xl font-semibold tracking-tight print:hidden">
        Location plan
      </h1>
      <PlanExport
        projectId={projectId}
        comparisonId={typeof comparison === "string" ? comparison : undefined}
        investigationId={
          typeof investigation === "string" ? investigation : undefined
        }
      />
    </div>
  );
}
