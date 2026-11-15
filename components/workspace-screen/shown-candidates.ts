/**
 * Resolve the requested visible IDs, choices and open site against current search results.
 * The workspace passes every search ID; stale IDs never invent a visible location.
 */
export function shownSiteIds(
  topIds: readonly string[],
  selectedIds: readonly string[],
  openId: string | undefined,
): string[] {
  return [...new Set([...topIds, ...selectedIds, ...(openId ? [openId] : [])])];
}

export function shownCandidates<T extends { candidate: { id: string } }>(
  candidates: readonly T[],
  topIds: readonly string[],
  selectedIds: readonly string[],
  openId: string | undefined,
): T[] {
  const byId = new Map(candidates.map((entry) => [entry.candidate.id, entry]));
  return shownSiteIds(topIds, selectedIds, openId).flatMap((id) => {
    const entry = byId.get(id);
    return entry ? [entry] : [];
  });
}
