import { createInteriorAffordabilityHandler } from "./handler";
import { readConfiguredInteriorAffordability } from "./runtime";
export const dynamic = "force-dynamic";
export const maxDuration = 30;
export const POST = createInteriorAffordabilityHandler(
  readConfiguredInteriorAffordability,
);
