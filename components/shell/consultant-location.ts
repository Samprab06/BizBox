/**
 * HAC-143: the site the founder is looking at, read from the current URL when the
 * consultant's voice asks for context: `/sites/<id>` or `?site=<id>` (ids up to 200 chars).
 */
export function selectedSiteFromLocation(
  pathname: string,
  search: string,
): string | undefined {
  const fromPath = /\/sites\/([^/?#]+)/.exec(pathname)?.[1];
  let raw: string | undefined;
  try {
    raw = fromPath
      ? decodeURIComponent(fromPath)
      : (new URLSearchParams(search).get("site") ?? undefined);
  } catch {
    return undefined;
  }
  return raw && raw.length <= 200 ? raw : undefined;
}
