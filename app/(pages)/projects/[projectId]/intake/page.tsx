import { IntakeScreen } from "@/components/intake/intake-screen";
import { WorkspaceView, type PreviewPageProps } from "@/components/workspace-view";

type IntakePageProps = PreviewPageProps & {
  searchParams: Promise<Awaited<PreviewPageProps["searchParams"]> & { mode?: string | string[] }>;
};

export default async function Page({ params, searchParams }: IntakePageProps) {
  const [{ projectId }, { site, mode }] = await Promise.all([params, searchParams]);
  const siteId = typeof site === "string" ? site : undefined;
  // HAC-127: the guided onboarding is the default; ?mode=form shows the detailed form.
  return (
    <WorkspaceView projectId={projectId} view="intake" siteId={siteId}>
      <IntakeScreen projectId={projectId} siteId={siteId} mode={mode === "form" ? "form" : "guided"} />
    </WorkspaceView>
  );
}
