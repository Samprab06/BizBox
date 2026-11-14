import Image from "next/image";
import Link from "next/link";
import logo from "@/branding/bizbox-logo-dark.png";
import { ConsultantShell } from "@/components/shell/consultant-shell";
import { ProjectContextProvider } from "@/components/shell/context-bar";
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
            className="inline-flex items-center rounded-md"
          >
            <Image
              src={logo}
              alt=""
              priority
              className="h-7 w-auto"
              sizes="102px"
            />
            <span className="sr-only">BizBox</span>
          </Link>
        </div>
      </header>
      {project ? (
        <ConsultantShell projectId={projectId} project={project}>
          <ProjectContextProvider project={project}>
            {children}
          </ProjectContextProvider>
        </ConsultantShell>
      ) : (
        <main className="min-w-0 px-5 py-7 sm:px-8">{children}</main>
      )}
    </>
  );
}
