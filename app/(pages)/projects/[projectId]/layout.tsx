import { ProjectFrame } from "@/components/shell/project-frame";
import { ProjectContextProvider } from "@/components/shell/context-bar";
import { getPreviewProject } from "@/lib/workspace-preview";

export default async function ProjectLayout({
  children,
  params,
}: {
  children: React.ReactNode;
  params: Promise<{ projectId: string }>;
}) {
  const project = getPreviewProject((await params).projectId);
  return (
    <ProjectFrame>
      {project ? (
        <ProjectContextProvider project={project}>
          {children}
        </ProjectContextProvider>
      ) : (
        children
      )}
    </ProjectFrame>
  );
}
