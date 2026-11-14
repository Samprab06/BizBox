import { IntakeScreen } from "@/components/intake/intake-screen";
import { TaskNav } from "@/components/shell/task-nav";
import { WorkspaceView, type PreviewPageProps } from "@/components/workspace-view";
import { getPreviewProject } from "@/lib/workspace-preview";

type IntakePageProps = PreviewPageProps & {
  searchParams: Promise<Awaited<PreviewPageProps["searchParams"]> & { mode?: string | string[] }>;
};

export default async function Page({ params, searchParams }: IntakePageProps) {
  const [{ projectId }, { site, mode }] = await Promise.all([params, searchParams]);
  const siteId = typeof site === "string" ? site : undefined;
  const project = getPreviewProject(projectId);

  // HAC-127: the guided onboarding is the default; ?mode=form shows the detailed form.
  // HAC-129: the guided questions sit directly on the dark glass stage (the HAC-112 design),
  // not inside the shell's white card with a second page title. The project navigation stays
  // above it and the page keeps its "Intake" heading for assistive technology.
  if (mode !== "form" && project) {
    return (
      <>
        <TaskNav projectId={projectId} route="intake" siteId={siteId ?? project.sites[0]?.id} />
        <section aria-label="Intake" className="mt-6">
          <h1 className="sr-only">Intake</h1>
          <IntakeScreen projectId={projectId} siteId={siteId} mode="guided" />
        </section>
      </>
    );
  }
  return (
    <WorkspaceView projectId={projectId} view="intake" siteId={siteId}>
      <IntakeScreen projectId={projectId} siteId={siteId} mode={mode === "form" ? "form" : "guided"} />
    </WorkspaceView>
  );
}
