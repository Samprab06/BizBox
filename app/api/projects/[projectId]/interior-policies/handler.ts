import { z } from "zod";
import { readJsonBody, BodyError } from "@/lib/evaluation/http";
import {
  InteriorPoliciesRequestSchema,
  InteriorPolicyError,
  type InteriorPolicyInput,
} from "@/lib/interior/policies";
export function createInteriorPoliciesHandler(
  work: (input: InteriorPolicyInput, signal?: AbortSignal) => Promise<unknown>,
) {
  return async (
    request: Request,
    context: { params: Promise<{ projectId: string }> },
  ) => {
    const headers = { "Cache-Control": "private, no-store" };
    try {
      const { projectId } = await context.params;
      z.string().trim().min(1).max(200).parse(projectId);
      const input = InteriorPoliciesRequestSchema.parse(
        await readJsonBody(request, 64 * 1024),
      );
      return Response.json(
        await work({ projectId, ...input }, request.signal),
        { headers },
      );
    } catch (error) {
      if (error instanceof BodyError || error instanceof z.ZodError)
        return Response.json(
          { code: "invalid", message: "Invalid interior policy request" },
          { status: 422, headers },
        );
      if (error instanceof InteriorPolicyError)
        return Response.json(
          { code: error.code, message: error.message },
          {
            status:
              error.code === "scope"
                ? 404
                : error.code === "unsupported"
                  ? 422
                  : error.code === "budget_exhausted"
                    ? 429
                    : 503,
            headers,
          },
        );
      return Response.json(
        {
          code: "unavailable",
          message:
            "Interior Jev budget, cache or source is unavailable; no assumed policy was substituted",
        },
        { status: 503, headers },
      );
    }
  };
}
