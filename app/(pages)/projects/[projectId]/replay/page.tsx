import {
  WorkspaceView,
  type PreviewPageProps,
} from "@/components/workspace-view";
import { comparisonScenario } from "@/components/comparison/comparison-screen";
import { ReplayScreen } from "@/components/replay/replay-screen";
import { getPreviewProject } from "@/lib/workspace-preview";
import { ReplayWorkspace } from "@/components/live-comparison-workspace";

export default async function Page({ params, searchParams }: PreviewPageProps) {
  const [{ projectId }, { site, visits, comparison, day }] = await Promise.all([
    params,
    searchParams,
  ]);
  const project = getPreviewProject(projectId);
  const siteId = typeof site === "string" ? site : undefined;
  return (
    <WorkspaceView projectId={projectId} view="replay" siteId={siteId}>
      {project && (
        <ReplayWorkspace
          project={project}
          siteId={siteId}
          comparisonId={typeof comparison === "string" ? comparison : undefined}
          dayType={day === "weekend" ? "weekend" : "weekday"}
          example={
            <>
              <ReplayScreen
                project={project}
                visits={comparisonScenario(visits)}
                siteId={
                  project.sites.some((site) => site.id === siteId)
                    ? siteId
                    : undefined
                }
              />
              <p className="mt-6 text-xs text-muted">Example data</p>
            </>
          }
        />
      )}
    </WorkspaceView>
  );
}
