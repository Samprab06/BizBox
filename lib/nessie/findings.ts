/** Structural subset shared by saved backend milestones and the consultant UI. */
export type NessieFindingMilestone = {
  investigationId: string;
  attempt: number;
  seq: number;
  tool: string;
  summary?: unknown;
};
const record = (value: unknown): Record<string, unknown> =>
  value !== null && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
const strings = (value: unknown): string[] =>
  Array.isArray(value)
    ? value.filter((entry): entry is string => typeof entry === "string")
    : [];
const scope = (entry: NessieFindingMilestone) =>
  JSON.stringify([entry.investigationId, entry.attempt]);

/**
 * Banking prose loses validity with its saved snapshot. Exact tool findings and
 * messages are attributable; model prose after a banking read may derive from
 * that cash, so conservatively remove it as well. Verified unrelated tool
 * findings and earlier nonfinancial notes remain intact.
 */
export function withoutNessieFindings(
  findings: readonly string[],
  milestones: readonly NessieFindingMilestone[],
): string[] {
  const firstCash = new Map<string, number>();
  for (const entry of milestones) {
    if (entry.tool !== "read_nessie_cash_buffer") continue;
    const key = scope(entry);
    firstCash.set(key, Math.min(firstCash.get(key) ?? Infinity, entry.seq));
  }
  const attributed = new Set<string>();
  for (const entry of milestones) {
    const envelope = record(entry.summary);
    if (entry.tool === "read_nessie_cash_buffer") {
      for (const finding of strings(envelope.toolFindings))
        attributed.add(finding);
      const output = record(envelope.output);
      if (typeof output.message === "string") attributed.add(output.message);
    }
    const first = firstCash.get(scope(entry));
    if (first !== undefined && entry.seq >= first) {
      for (const finding of strings(envelope.modelFindings))
        attributed.add(finding);
    }
  }
  return findings.filter((finding) => !attributed.has(finding));
}
