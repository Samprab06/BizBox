import { IntakeScreen } from "@/components/intake/intake-screen";
import { WorkspaceView, type PreviewPageProps } from "@/components/workspace-view";
import { getPreviewProject } from "@/lib/workspace-preview";

type IntakePageProps = PreviewPageProps & {
  searchParams: Promise<Awaited<PreviewPageProps["searchParams"]> & { mode?: string | string[] }>;
};

/**
 * Scene 1: the flow's `questions` step. The progress stepper in the project header is the
 * only navigation, so this page renders no task navigation of its own.
 */
export default async function Page({ params, searchParams }: IntakePageProps) {
  const [{ projectId }, { site, mode }] = await Promise.all([params, searchParams]);
  const siteId = typeof site === "string" ? site : undefined;
  const project = getPreviewProject(projectId);

  // An unknown project keeps WorkspaceView's "Project unavailable" way back.
  if (!project) return <WorkspaceView projectId={projectId} view="intake" siteId={siteId} />;

  // HAC-127: the guided onboarding is the default; ?mode=form shows the detailed form.
  // HAC-129: the guided questions sit directly on the dark glass stage (the HAC-112 design),
  // not inside a white card with a second page title; the page keeps its "Intake" heading
  // for assistive technology.
  if (mode !== "form") {
    return (
      <section aria-label="Intake" className="mt-6">
        <h1 className="sr-only">Intake</h1>
        <IntakeScreen projectId={projectId} siteId={siteId} mode="guided" />
      </section>
    );
  }
  return (
    <>
      <header className="my-10">
        <p className="mb-2 text-sm font-medium text-muted">{project.name}</p>
        <h1 className="text-4xl font-semibold tracking-tight">Intake</h1>
      </header>
      <section aria-label="Intake" className="rounded-2xl border border-line bg-white p-7">
        <IntakeScreen projectId={projectId} siteId={siteId} mode="form" />
      </section>
    </>
  );
}
