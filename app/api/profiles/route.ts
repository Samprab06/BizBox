import { createPostgresProfileStore } from "@/lib/profiles/store-postgres";
import { createProfilesHandler } from "./handler";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const POST = createProfilesHandler(createPostgresProfileStore());
