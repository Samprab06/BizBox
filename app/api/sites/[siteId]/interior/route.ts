import { getInterior } from "@/lib/interior/runtime";
import { createInteriorHandler } from "./handler";

export const dynamic = "force-dynamic";
export const GET = createInteriorHandler(getInterior);
