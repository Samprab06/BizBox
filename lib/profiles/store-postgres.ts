import "server-only";
import { randomUUID } from "node:crypto";
import { and, eq, max } from "drizzle-orm";
import { BusinessProfileSchema } from "@/lib/contracts";
import { getDb } from "@/lib/db/client";
import { profiles, projects } from "@/lib/db/schema";
import type { ProfileStore } from "./store";

export function createPostgresProfileStore(
  database: typeof getDb = getDb,
  newId: () => string = () => `profile_${randomUUID()}`,
): ProfileStore {
  return {
    async saveSnapshot(projectId, input) {
      const profile = BusinessProfileSchema.parse(input);
      if (profile.projectId !== projectId)
        throw new Error("Profile project mismatch");
      return database().transaction(async (tx) => {
        // Serialize only snapshots for this existing project; never overwrite a
        // historical profile or accept a client-supplied version/identity.
        const [project] = await tx
          .select({ id: projects.id })
          .from(projects)
          .where(eq(projects.id, projectId))
          .for("update");
        if (!project) return null;
        const [latest] = await tx
          .select({ version: max(profiles.version) })
          .from(profiles)
          .where(eq(profiles.projectId, projectId));
        const snapshot = BusinessProfileSchema.parse({
          ...profile,
          id: newId(),
          projectId,
          version: (latest?.version ?? 0) + 1,
        });
        await tx.insert(profiles).values({
          id: snapshot.id,
          projectId,
          version: snapshot.version,
          snapshot,
        });
        return snapshot;
      });
    },
    async load(projectId, profileId) {
      const [row] = await database()
        .select()
        .from(profiles)
        .where(
          and(eq(profiles.projectId, projectId), eq(profiles.id, profileId)),
        )
        .limit(1);
      if (!row) return null;
      const profile = BusinessProfileSchema.parse(row.snapshot);
      if (
        profile.id !== row.id ||
        profile.projectId !== row.projectId ||
        profile.version !== row.version
      )
        throw new Error("Stored profile identity mismatch");
      return profile;
    },
  };
}
