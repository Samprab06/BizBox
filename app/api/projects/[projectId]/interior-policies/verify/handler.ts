import { z } from "zod";
import {
  SpatialPoliciesSchema,
  SpatialPolicyReceiptSchema,
} from "@/lib/contracts/spatial";
import {
  InteriorPoliciesRequestSchema,
  InteriorPolicyError,
} from "@/lib/interior/policies";
import type { InteriorPolicyReceiptInput } from "@/lib/interior/policies-receipt";
import { readJsonBody, BodyError } from "@/lib/evaluation/http";
const body = InteriorPoliciesRequestSchema.extend({
  policies: SpatialPoliciesSchema,
  receipt: SpatialPolicyReceiptSchema,
}).strict();
export function createInteriorPolicyVerifyHandler(
  work: (
    input: InteriorPolicyReceiptInput,
    receipt: unknown,
  ) => Promise<{ valid: true }>,
) {
  return async (
    request: Request,
    context: { params: Promise<{ projectId: string }> },
  ) => {
    const headers = { "Cache-Control": "private, no-store" };
    try {
      const { projectId } = await context.params;
      z.string().trim().min(1).max(200).parse(projectId);
      const { receipt, ...input } = body.parse(
        await readJsonBody(request, 128 * 1024),
      );
      return Response.json(await work({ projectId, ...input }, receipt), {
        headers,
      });
    } catch (error) {
      if (error instanceof BodyError || error instanceof z.ZodError)
        return Response.json(
          { valid: false, code: "invalid" },
          { status: 422, headers },
        );
      return Response.json(
        {
          valid: false,
          code:
            error instanceof InteriorPolicyError ? error.code : "unavailable",
        },
        {
          status:
            error instanceof InteriorPolicyError && error.code === "scope"
              ? 403
              : 503,
          headers,
        },
      );
    }
  };
}
