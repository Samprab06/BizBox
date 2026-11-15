import { workspaceHref } from "@/lib/client/workspace-routes";

/** The boundary is above [projectId]'s layout, so read only a safe local project segment. */
export function projectMapFromPath(
  pathname: string | null,
): string | undefined {
  const encoded = pathname?.match(/^\/projects\/([^/]+)(?:\/|$)/)?.[1];
  if (!encoded) return undefined;
  try {
    const projectId = decodeURIComponent(encoded);
    if (!/^[a-z0-9_-]{1,200}$/i.test(projectId)) return undefined;
    return workspaceHref(projectId, "map");
  } catch {
    return undefined;
  }
}
