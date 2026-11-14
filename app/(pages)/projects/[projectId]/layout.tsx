import Link from "next/link";
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
            className="text-xl font-bold tracking-tight text-pine"
          >
            BizBox
          </Link>
        </div>
      </header>
      <main className="mx-auto max-w-5xl px-5 py-7 sm:px-8">
        {project ? (
          <ProjectContextProvider project={project}>
            {children}
          </ProjectContextProvider>
        ) : (
          children
        )}
      </main>
    </>
  );
}
