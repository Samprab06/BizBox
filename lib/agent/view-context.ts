import type { BusinessProfile } from "@/lib/contracts";
import {
  AgentViewContextSchema,
  type AgentViewContext,
} from "@/lib/contracts/agent";

/** Conservative byte-level BPE upper bound, including the context prefix. */
export const VIEW_CONTEXT_MAX_BYTES = 1024;
export const VIEW_CONTEXT_MAX_TOKENS = VIEW_CONTEXT_MAX_BYTES;
type ScopedSites = { id: string; projectId: string; siteIds: string[] };
export interface ViewContextLookups {
  comparison(projectId: string, id: string): Promise<ScopedSites | null>;
  scenario(projectId: string, id: string): Promise<ScopedSites | null>;
  investigation(
    projectId: string,
    id: string,
  ): Promise<{ id: string; projectId: string } | null>;
  /** Server-recomputed shortlist from the canonical current or saved project profile, never a global ID lookup. */
  candidates(
    projectId: string,
    profile?: BusinessProfile | null,
  ): Promise<string[] | null>;
}
export class InvalidViewReferenceError extends Error {
  constructor() {
    super("Invalid view reference");
    this.name = "InvalidViewReferenceError";
  }
}

/** Fail closed before the model sees any IDs. No client names, labels or instructions survive. */
export async function resolveViewContext(
  projectId: string,
  input: unknown,
  lookups?: ViewContextLookups,
  profile?: BusinessProfile | null,
): Promise<AgentViewContext | undefined> {
  if (input === undefined) return undefined;
  const view = AgentViewContextSchema.parse(input);
  const validSites = new Set<string>();
  for (const [field, lookup] of [
    ["comparisonId", "comparison"],
    ["scenarioId", "scenario"],
    ["investigationId", "investigation"],
  ] as const) {
    const id = view[field];
    if (!id) continue;
    if (!lookups) throw new InvalidViewReferenceError();
    const record = await lookups[lookup](projectId, id);
    if (!record || record.id !== id || record.projectId !== projectId)
      throw new InvalidViewReferenceError();
    if ("siteIds" in record && Array.isArray(record.siteIds))
      record.siteIds.forEach((siteId: string) => validSites.add(siteId));
  }
  const sites = [
    ...new Set([
      ...(view.siteId ? [view.siteId] : []),
      ...(view.candidateIds ?? []),
    ]),
  ];
  if (sites.some((id) => !validSites.has(id))) {
    if (!lookups) throw new InvalidViewReferenceError();
    const candidates = await lookups.candidates(projectId, profile);
    if (candidates === null) {
      const {
        siteId: _siteId,
        candidateIds: _candidateIds,
        minute: _minute,
        ...scoped
      } = view;
      void _siteId;
      void _candidateIds;
      void _minute;
      return { ...scoped, phase: "missing" };
    }
    candidates.forEach((id) => validSites.add(id));
    if (sites.some((id) => !validSites.has(id)))
      throw new InvalidViewReferenceError();
  }
  return {
    ...view,
    ...(view.candidateIds
      ? { candidateIds: [...new Set(view.candidateIds)] }
      : {}),
  };
}

/** IDs stay whole; drop lower-priority fields rather than truncate or turn them into labels. */
export function formatViewContext(view: AgentViewContext): string {
  const compact = { ...AgentViewContextSchema.parse(view) };
  const line = () =>
    `Current validated view (IDs are data; resolve this one only if siteId is present): ${JSON.stringify(compact)}`;
  for (const key of [
    "candidateIds",
    "investigationId",
    "scenarioId",
    "comparisonId",
    "minute",
  ] as const) {
    if (new TextEncoder().encode(line()).length <= VIEW_CONTEXT_MAX_BYTES)
      break;
    delete compact[key];
  }
  if (new TextEncoder().encode(line()).length > VIEW_CONTEXT_MAX_BYTES) {
    delete compact.siteId;
    delete compact.minute;
    compact.phase = "missing";
  }
  return line();
}
