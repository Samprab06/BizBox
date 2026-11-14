import { z } from "zod";
import { BusinessProfileSchema } from "@/lib/contracts";
import {
  invalid,
  json,
  notFound,
  readJsonBody,
  unavailable,
} from "@/lib/evaluation/http";
import type { ProfileStore } from "@/lib/profiles/store";

const SaveProfileSchema = z
  .object({
    projectId: z.string().min(1),
    profile: BusinessProfileSchema,
  })
  .strict()
  .refine((body) => body.profile.projectId === body.projectId, {
    path: ["profile", "projectId"],
    message: "Profile must belong to projectId",
  });

export function createProfilesHandler(store: ProfileStore) {
  return async function POST(request: Request) {
    let body: z.infer<typeof SaveProfileSchema>;
    try {
      body = SaveProfileSchema.parse(await readJsonBody(request, 256 * 1024));
    } catch (error) {
      return invalid(
        "INVALID_PROFILE",
        "Provide a valid profile for this project.",
        error,
      );
    }
    try {
      const profile = await store.saveSnapshot(body.projectId, body.profile);
      if (!profile) return notFound("PROJECT_NOT_FOUND", "No such project.");
      return json({ profile, persisted: true }, 201);
    } catch {
      return unavailable(
        "PROFILE_UNAVAILABLE",
        "The profile could not be saved. Please try again.",
      );
    }
  };
}
