import type { BusinessProfile } from "@/lib/contracts";

/** Immutable snapshots use server IDs and project-wide monotonic versions. */
export interface ProfileStore {
  saveSnapshot(
    projectId: string,
    profile: BusinessProfile,
  ): Promise<BusinessProfile | null>;
  load(projectId: string, profileId: string): Promise<BusinessProfile | null>;
}

const canonical = (value: unknown): unknown =>
  Array.isArray(value)
    ? value.map(canonical)
    : value && typeof value === "object"
      ? Object.fromEntries(
          Object.entries(value)
            .filter(([, v]) => v !== undefined)
            .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
            .map(([k, v]) => [k, canonical(v)]),
        )
      : value;

/** Stable key of a profile's content; ignores server identity (id, version). */
export function profileContentKey(profile: BusinessProfile): string {
  const content: Partial<BusinessProfile> = { ...profile };
  delete content.id;
  delete content.version;
  // Both representations mean no geographic rules; avoid spurious profile versions.
  if (content.areaPreferences?.rectangles.length === 0)
    delete content.areaPreferences;
  return JSON.stringify(canonical(content));
}
