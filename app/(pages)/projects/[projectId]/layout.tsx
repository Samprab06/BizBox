import Link from "next/link";
import { BrandLogo } from "@/components/brand/brand-logo";
import { CopilotDock } from "@/components/copilot/copilot-dock";
import { CopilotProvider } from "@/components/copilot/copilot-provider";
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
    <>
      <header className="border-b border-line bg-white">
        <div className="mx-auto max-w-5xl px-5 py-5 sm:px-8">
          <Link
            href="/projects/houston-coffee/intake"
            className="inline-flex items-center"
          >
            <BrandLogo onDark priority className="h-8 w-auto print:invert" />
          </Link>
        </div>
      </header>
      <main className="mx-auto max-w-5xl px-5 py-7 sm:px-8">
        {project ? (
          <ProjectContextProvider project={project}>
            {/* HAC-84: the layout stays mounted across navigation, so the dock does too. */}
            <CopilotProvider projectId={project.id}>
              {children}
              <CopilotDock />
            </CopilotProvider>
          </ProjectContextProvider>
        ) : (
          children
        )}
      </main>
    </>
  );
}
