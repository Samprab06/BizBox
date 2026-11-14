import { TaskNav } from "@/components/shell/task-nav";
import type { PreviewPageProps } from "@/components/workspace-view";
import { WorkspaceScreen } from "@/components/workspace-screen/workspace-screen";
import { getPreviewProject } from "@/lib/workspace-preview";

/** HAC-128: the BizBox workspace screen (city/budget, selected space, Text/Voice assistant). */
export default async function Page({ params, searchParams }: PreviewPageProps) {
  const [{ projectId }, { site }] = await Promise.all([params, searchParams]);
  const project = getPreviewProject(projectId);
  const siteId =
    typeof site === "string" && site.length <= 200 ? site : undefined;
  return (
    <>
      <TaskNav
        projectId={projectId}
        route="workspace"
        siteId={siteId ?? project?.sites[0]?.id}
      />
      <WorkspaceScreen
        projectId={projectId}
        project={project}
        siteId={siteId}
      />
    </>
  );
}
