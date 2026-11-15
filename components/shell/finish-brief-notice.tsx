import Link from "next/link";
import { workspaceHref } from "@/lib/client/workspace-routes";

export function FinishBriefNotice({
  projectId,
  message,
}: {
  projectId: string;
  message: string;
}) {
  return (
    <div className="rounded-lg bg-canvas p-4">
      <p role="status">{message}</p>
      <Link
        className="mt-2 inline-block font-semibold text-accent underline"
        href={workspaceHref(projectId, "intake")}
      >
        Finish brief
      </Link>
    </div>
  );
}
