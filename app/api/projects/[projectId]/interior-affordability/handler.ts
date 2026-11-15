import { z } from "zod";
import { readJsonBody, BodyError } from "@/lib/evaluation/http";
import {
  InteriorAffordabilityRequestSchema,
  type InteriorAffordabilityRequest,
} from "@/lib/contracts/interior-affordability";
import { InteriorAffordabilityError } from "@/lib/nessie/interior-assessment";
export function createInteriorAffordabilityHandler(
  work: (
    projectId: string,
    input: InteriorAffordabilityRequest,
    signal: AbortSignal,
  ) => Promise<unknown>,
) {
  return async (
    request: Request,
    context: { params: Promise<{ projectId: string }> },
  ) => {
    const headers = { "Cache-Control": "private, no-store" };
    try {
      const params = await context.params,
        projectId = z.string().trim().min(1).max(200).parse(params.projectId);
      const input = InteriorAffordabilityRequestSchema.parse(
        await readJsonBody(request, 64 * 1024),
      );
      request.signal.throwIfAborted();
      return Response.json(await work(projectId, input, request.signal), {
        headers,
      });
    } catch (error) {
      if (error instanceof z.ZodError || error instanceof BodyError)
        return Response.json(
          {
            code: "invalid",
            message: "Invalid reviewed interior affordability request",
          },
          { status: 422, headers },
        );
      if (error instanceof InteriorAffordabilityError)
        return Response.json(
          { code: error.code, message: error.message },
          {
            status:
              error.code === "scope"
                ? 404
                : error.code === "unreviewed"
                  ? 409
                  : error.code === "invalid"
                    ? 422
                    : 503,
            headers,
          },
        );
      return Response.json(
        {
          code: "unavailable",
          message:
            "The current comparison or simulated Nessie cash assessment is unavailable. No affordability claim was made.",
        },
        { status: 503, headers },
      );
    }
  };
}
