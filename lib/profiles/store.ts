import type { BusinessProfile } from "@/lib/contracts";

/** Immutable snapshots use server IDs and project-wide monotonic versions. */
export interface ProfileStore {
  saveSnapshot(
    projectId: string,
    profile: BusinessProfile,
  ): Promise<BusinessProfile | null>;
  load(projectId: string, profileId: string): Promise<BusinessProfile | null>;
}
