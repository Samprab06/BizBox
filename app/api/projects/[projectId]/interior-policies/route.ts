import { createInteriorPoliciesHandler } from "./handler";
import { prepareConfiguredInteriorPolicies } from "@/lib/interior/policies-runtime";
export const dynamic = "force-dynamic";
export const maxDuration = 60;
export const POST = createInteriorPoliciesHandler(
  prepareConfiguredInteriorPolicies,
);
