import { z } from "zod";
import {
  StationExperimentPlanRequestSchema,
  StationExperimentPostSchema,
} from "@/lib/contracts/station-experiment-run";
import { BodyError, readJsonBody } from "@/lib/evaluation/http";
import { ScenarioRunError } from "@/lib/scenario/run-store";
import type { StationExperimentService } from "@/lib/insights/station-experiment-service";
const json = (value: unknown, status = 200) =>
  Response.json(value, {
    status,
    headers: { "Cache-Control": "private, no-store" },
  });
const id = z.string().trim().min(1).max(200);
type Context = { params: Promise<{ projectId: string }> };
export function createStationExperimentHandlers(
  service: StationExperimentService,
) {
  const handle =
    (work: (request: Request, projectId: string) => Promise<Response>) =>
    async (request: Request, context: Context) => {
      try {
        return await work(request, id.parse((await context.params).projectId));
      } catch (error) {
        const fields: Record<string, string[]> = {};
        if (error instanceof z.ZodError)
          for (const issue of error.issues)
            (fields[issue.path.join(".") || "_request"] ??= []).push(
              issue.message,
            );
        const status =
          error instanceof ScenarioRunError
            ? error.code === "not_found"
              ? 404
              : error.code === "invalid"
                ? 422
                : 409
            : error instanceof z.ZodError || error instanceof BodyError
              ? 422
              : 503;
        return json(
          {
            code:
              status === 404
                ? "STATION_EXPERIMENT_NOT_FOUND"
                : status === 422
                  ? "INVALID_STATION_EXPERIMENT"
                  : status === 409
                    ? "STATION_EXPERIMENT_CONFLICT"
                    : "STATION_EXPERIMENT_UNAVAILABLE",
            message:
              status === 404
                ? "Saved comparison or site not found."
                : status === 422
                  ? "Provide valid station experiment values."
                  : status === 409
                    ? "Execution ownership changed. Reload before continuing."
                    : "Station experiment service is temporarily unavailable.",
            field_errors: fields,
          },
          status,
        );
      }
    };
  return {
    GET: handle(async (request, projectId) => {
      const search = new URL(request.url).searchParams;
      if ([...search.keys()].some((k) => search.getAll(k).length !== 1))
        throw new BodyError("Duplicate query fields");
      const input = StationExperimentPlanRequestSchema.parse(
        Object.fromEntries(search),
      );
      return json(await service.get(projectId, input));
    }),
    POST: handle(async (request, projectId) => {
      const input = StationExperimentPostSchema.parse(
        await readJsonBody(request, 32 * 1024),
      );
      const result = await service.post(projectId, input);
      return json(result, result.status === "running" ? 202 : 200);
    }),
  };
}
