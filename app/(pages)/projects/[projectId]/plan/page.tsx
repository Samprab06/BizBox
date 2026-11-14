import { notFound } from "next/navigation";
import { PlanExport } from "@/components/plan/plan-export";
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
  if (!getPreviewProject(projectId)) notFound();
  return (
    <div className="print:text-black">
      <h1 className="mb-6 text-4xl font-semibold tracking-tight print:hidden">
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
