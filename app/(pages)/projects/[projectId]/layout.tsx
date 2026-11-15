import Link from "next/link";
import { BrandLogo } from "@/components/brand/brand-logo";
import { CopilotDock } from "@/components/copilot/copilot-dock";
import { CopilotProvider } from "@/components/copilot/copilot-provider";
import { ConsultantShell } from "@/components/shell/consultant-shell";
import {
  ProjectContextBar,
  ProjectContextProvider,
} from "@/components/shell/context-bar";
import { getPreviewProject } from "@/lib/workspace-preview";

/**
 * HAC-143: the project layout stays mounted across client navigation, so it hosts the
 * persistent consultant. The URL stays the current step; the shell places the consultant
 * beside it (or full screen) and keeps one conversation for the whole project.
 */
export default async function ProjectLayout({
  children,
  params,
}: {
  children: React.ReactNode;
  params: Promise<{ projectId: string }>;
}) {
  const { projectId } = await params;
  const project = getPreviewProject(projectId);
  return (
    <>
      {/* Stage 2 minimal glass header; DS-8 restyles it with the shared tokens. */}
      <header className="sticky top-0 z-30 h-16 border-b border-line/70 bg-paper/75 backdrop-blur-md supports-[backdrop-filter]:bg-paper/60">
        <div className="flex h-full items-center px-5 sm:px-8">
          <Link
            href="/projects/houston-coffee/intake"
            className="inline-flex items-center"
          >
            <BrandLogo onDark priority className="h-8 w-auto print:invert" />
          </Link>
        </div>
      </header>
      {project ? (
        // HAC-84's copilot (scenario, plan, proposed changes) sits in the consultant's dock
        // under the assistant, so every consultant panel persists with the shell.
        <ProjectContextProvider project={project} showContextBar={false}>
          <CopilotProvider projectId={project.id}>
            <ConsultantShell
              projectId={projectId}
              project={project}
              companion={<CopilotDock />}
            >
              <ProjectContextBar />
              {children}
            </ConsultantShell>
          </CopilotProvider>
        </ProjectContextProvider>
      ) : (
        <main className="min-w-0 px-5 py-7 sm:px-8">{children}</main>
      )}
    </>
  );
}
