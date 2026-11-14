import { z } from "zod";
import { readJsonBody } from "@/lib/evaluation/http";
import type { ScenarioRunner } from "@/lib/scenario/run";
import { scenarioFailure } from "./handler";

type Context = {
  params: Promise<{ projectId: string; id: string; runId?: string }>;
};
const id = z.string().trim().min(1).max(200);
const headers = { "Cache-Control": "private, no-store" };
const empty = z.object({}).strict();
export function createScenarioRunHandlers(runner: ScenarioRunner) {
  const handle =
    (
      work: (
        request: Request,
        ids: { projectId: string; scenarioId: string; runId?: string },
      ) => Promise<Response>,
    ) =>
    async (request: Request, context: Context) => {
      try {
        const params = await context.params;
        return await work(request, {
          projectId: id.parse(params.projectId),
          scenarioId: id.parse(params.id),
          ...(params.runId === undefined
            ? {}
            : { runId: id.parse(params.runId) }),
        });
      } catch (error) {
        return scenarioFailure(error);
      }
    };
  return {
    start: handle(async (request, { projectId, scenarioId }) => {
      const result = await runner.start(
        projectId,
        scenarioId,
        request.body ? await readJsonBody(request, 64 * 1024) : {},
      );
      return Response.json(result, {
        status:
          result.status === "needs_confirmation" || result.status === "failed"
            ? 200
            : result.status === "succeeded"
              ? 201
              : 202,
        headers,
      });
    }),
    get: handle(async (_request, { projectId, scenarioId, runId }) =>
      Response.json(await runner.get(projectId, scenarioId, id.parse(runId)), {
        headers,
      }),
    ),
    advance: handle(async (request, { projectId, scenarioId, runId }) => {
      empty.parse(request.body ? await readJsonBody(request, 64 * 1024) : {});
      const result = await runner.advance(
        projectId,
        scenarioId,
        id.parse(runId),
      );
      return Response.json(result, {
        status:
          result.status === "running" || result.status === "queued" ? 202 : 200,
        headers,
      });
    }),
  };
}
