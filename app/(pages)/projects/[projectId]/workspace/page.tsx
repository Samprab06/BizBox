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
    <WorkspaceScreen
      key={projectId}
      projectId={projectId}
      project={project}
      siteId={siteId}
      matterportSdkKey={process.env.MATTERPORT_SDK_KEY?.trim() || undefined}
      tilesetUrl={
        process.env.VEXCEL_API_KEY?.trim()
          ? "/api/vexcel/3d/tileset"
          : undefined
      }
    />
  );
}
