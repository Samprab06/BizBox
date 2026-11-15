import { createInteriorPolicyVerifyHandler } from "./handler";
import { verifyConfiguredInteriorPolicyReceipt } from "@/lib/interior/policies-runtime";
export const dynamic = "force-dynamic";
export const POST = createInteriorPolicyVerifyHandler(
  verifyConfiguredInteriorPolicyReceipt,
);
