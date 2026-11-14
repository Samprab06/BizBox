import { z } from "zod";
import { CreateInvestigationSchema } from "@/lib/contracts/investigations";
import {
  createInvestigationService,
  InvestigationJobError,
  type InvestigationRepository,
  type InvestigationStepPlanner,
} from "@/lib/agent/jobs";

type Context = { params: Promise<{ id: string }> };
const identifier = z.string().trim().min(1).max(200);
const advanceBody = z
  .object({ action: z.enum(["advance", "retry"]).default("advance") })
  .strict();
const json = (body: unknown, status = 200) =>
  Response.json(body, { status, headers: { "Cache-Control": "no-store" } });
function failure(error: unknown) {
  if (error instanceof InvestigationJobError) {
    if (error.code === "not_found")
      return json(
        {
          code: "INVESTIGATION_NOT_FOUND",
          message: "Investigation, project or profile not found.",
          field_errors: {},
        },
        404,
      );
    return json(
      {
        code: "INVESTIGATION_CONFLICT",
        message:
          "Investigation state or ownership changed. Reload its status before retrying.",
        field_errors: {},
      },
      409,
    );
  }
  return json(
    {
      code: "INVESTIGATION_UNAVAILABLE",
      message: "Investigations are temporarily unavailable.",
      field_errors: {},
    },
    503,
  );
}
function invalid(error: unknown) {
  const field_errors: Record<string, string[]> = {};
  if (error instanceof z.ZodError)
    for (const issue of error.issues)
      field_errors[issue.path.join(".") || "_request"] = [
        "Invalid investigation value",
      ];
  else field_errors._request = ["Invalid investigation request"];
  return json(
    {
      code: "INVALID_INVESTIGATION",
      message: "Provide valid investigation values.",
      field_errors,
    },
    422,
  );
}
async function body(request: Request, allowEmpty = false): Promise<unknown> {
  if (!request.body) {
    if (allowEmpty) return {};
    throw new Error("Missing body");
  }
  const reader = request.body.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > 64 * 1024) {
        await reader.cancel();
        throw new Error("Request too large");
      }
      chunks.push(value);
    }
  } finally {
    reader.releaseLock();
  }
  if (!size && allowEmpty) return {};
  const bytes = new Uint8Array(size);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes));
}

export function createInvestigationHandlers({
  repository,
  planner,
}: {
  repository: InvestigationRepository;
  planner?: InvestigationStepPlanner;
}) {
  const service = createInvestigationService(repository);
  const response = async (
    job: Awaited<ReturnType<typeof service.load>>,
    status = 200,
  ) =>
    json({ job, milestones: await repository.listMilestones(job.id) }, status);
  return {
    async create(request: Request) {
      let input: z.infer<typeof CreateInvestigationSchema>;
      try {
        input = CreateInvestigationSchema.parse(await body(request));
      } catch (error) {
        return invalid(error);
      }
      try {
        return await response(await service.create(input), 201);
      } catch (error) {
        return failure(error);
      }
    },
    async get(_request: Request, context: Context) {
      let id: string;
      try {
        id = identifier.parse((await context.params).id);
      } catch (error) {
        return invalid(error);
      }
      try {
        return await response(await service.load(id));
      } catch (error) {
        return failure(error);
      }
    },
    async advance(request: Request, context: Context) {
      let id: string;
      let input: z.infer<typeof advanceBody>;
      try {
        id = identifier.parse((await context.params).id);
        input = advanceBody.parse(await body(request, true));
      } catch (error) {
        return invalid(error);
      }
      try {
        if (input.action === "retry")
          return await response(await service.retry(id));
        if (!planner) {
          const job = await repository.load(id);
          if (!job)
            throw new InvestigationJobError(
              "not_found",
              "Investigation not found",
            );
          if (job.status === "succeeded") return await response(job);
          // HAC-23 provides the trusted server planner. Never execute fake tools
          // or mark unfinished production work successful in its absence.
          return json(
            {
              code: "INVESTIGATION_EXECUTOR_UNAVAILABLE",
              message: "The investigation executor is not configured yet.",
              field_errors: {},
            },
            503,
          );
        }
        return await response(
          await service.advance(id, planner, { maxDurationMs: 30_000 }),
        );
      } catch (error) {
        return failure(error);
      }
    },
  };
}
