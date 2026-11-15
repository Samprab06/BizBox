import "server-only";
import { createHash, createHmac, timingSafeEqual } from "node:crypto";
import { z } from "zod";
import {
  SpatialPoliciesSchema,
  SpatialPolicyReceiptSchema,
} from "@/lib/contracts/spatial";
import { InteriorPoliciesRequestSchema } from "./policies";
export const InteriorPolicyReceiptSchema = SpatialPolicyReceiptSchema;
export const InteriorPolicyReceiptInputSchema =
  InteriorPoliciesRequestSchema.extend({
    projectId: z.string().trim().min(1).max(200),
    policies: SpatialPoliciesSchema,
  }).strict();
export type InteriorPolicyReceiptInput = z.infer<
  typeof InteriorPolicyReceiptInputSchema
>;
function canonical(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`;
  if (value && typeof value === "object")
    return `{${Object.entries(value)
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([k, v]) => `${JSON.stringify(k)}:${canonical(v)}`)
      .join(",")}}`;
  return JSON.stringify(value);
}
function signature(digest: string, key: string) {
  if (!key.trim()) throw new Error("Interior policy signing key unavailable");
  const domainKey = createHmac("sha256", key)
    .update("bizbox/interior-policy-receipt/v1")
    .digest();
  return createHmac("sha256", domainKey).update(digest).digest("hex");
}
export function signInteriorPolicyReceipt(
  raw: InteriorPolicyReceiptInput,
  key: string,
) {
  const input = InteriorPolicyReceiptInputSchema.parse(raw),
    digest = createHash("sha256").update(canonical(input)).digest("hex");
  return { version: 1 as const, digest, signature: signature(digest, key) };
}
export function verifyInteriorPolicyReceipt(
  raw: InteriorPolicyReceiptInput,
  rawReceipt: unknown,
  key: string,
) {
  const receipt = InteriorPolicyReceiptSchema.safeParse(rawReceipt);
  if (!receipt.success) return false;
  const expected = signInteriorPolicyReceipt(raw, key);
  return (
    timingSafeEqual(
      Buffer.from(receipt.data.digest, "hex"),
      Buffer.from(expected.digest, "hex"),
    ) &&
    timingSafeEqual(
      Buffer.from(receipt.data.signature, "hex"),
      Buffer.from(expected.signature, "hex"),
    )
  );
}
