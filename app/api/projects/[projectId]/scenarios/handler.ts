import { z } from "zod";
import { BodyError, readJsonBody } from "@/lib/evaluation/http";
import { ScenarioError } from "@/lib/scenario/model";
import {
  ScenarioServiceError,
  type ScenarioService,
} from "@/lib/scenario/service";
import { ScenarioRepositoryError } from "@/lib/scenario/repository";
import { ScenarioRunError } from "@/lib/scenario/run-store";
import { LayoutInputError } from "@/lib/layout";
import { AssemblyError } from "@/lib/evaluation/assemble";

type Context = { params: Promise<{ projectId: string; id?: string }> };
const id = z.string().trim().min(1).max(200);
const json = (body: unknown, status = 200) =>
  Response.json(body, {
    status,
    headers: { "Cache-Control": "private, no-store" },
  });
export function scenarioFailure(error: unknown) {
  if (
    error instanceof ScenarioRunError &&
    (error.code === "busy" || error.code === "lease_lost")
  )
    return json(
      {
        code: "SCENARIO_RUN_CONFLICT",
        message:
          "Execution is already running or its ownership changed. Reload before advancing.",
        field_errors: {},
      },
      409,
    );
  if (
    error instanceof ScenarioServiceError ||
    error instanceof ScenarioRepositoryError ||
    error instanceof ScenarioRunError
  ) {
    if (error.code === "not_found")
      return json(
        {
          code: "SCENARIO_NOT_FOUND",
          message: "Scenario, project or profile version not found.",
          field_errors: {},
        },
        404,
      );
    if (error.code === "conflict")
      return json(
        {
          code: "SCENARIO_CONFLICT",
          message: "Scenario already exists.",
          field_errors: {},
        },
        409,
      );
  }
  if (
    error instanceof z.ZodError ||
    error instanceof ScenarioError ||
    error instanceof ScenarioServiceError ||
    error instanceof BodyError ||
    error instanceof LayoutInputError ||
    error instanceof AssemblyError ||
    (error instanceof ScenarioRunError && error.code === "invalid") ||
    (error instanceof ScenarioRepositoryError && error.code === "invalid")
  ) {
    const field_errors: Record<string, string[]> = {};
    if (error instanceof LayoutInputError)
      Object.assign(field_errors, error.fieldErrors);
    else if (error instanceof z.ZodError)
      for (const issue of error.issues)
        (field_errors[issue.path.join(".") || "_request"] ??= []).push(
          issue.message,
        );
    else field_errors._request = ["Invalid scenario value"];
    return json(
      {
        code: "INVALID_SCENARIO",
        message: "Provide valid scenario values.",
        field_errors,
      },
      422,
    );
  }
  return json(
    {
      code: "SCENARIO_UNAVAILABLE",
      message: "Scenario service is temporarily unavailable.",
      field_errors: {},
    },
    503,
  );
}

/** Factories keep database construction separate from input validation and tests. */
export function createScenarioHandlers(service: ScenarioService) {
  const execute =
    (
      work: (
        request: Request,
        params: { projectId: string; id?: string },
      ) => Promise<Response>,
    ) =>
    async (request: Request, context: Context) => {
      try {
        const raw = await context.params;
        const projectId = id.parse(raw.projectId);
        const scenarioId = raw.id === undefined ? undefined : id.parse(raw.id);
        return await work(request, { projectId, id: scenarioId });
      } catch (error) {
        return scenarioFailure(error);
      }
    };
  return {
    create: execute(async (request, { projectId }) =>
      json(
        {
          scenario: await service.create(
            projectId,
            await readJsonBody(request, 64 * 1024),
          ),
        },
        201,
      ),
    ),
    list: execute(async (_request, { projectId }) =>
      json({ tree: await service.list(projectId) }),
    ),
    get: execute(async (request, { projectId, id: scenarioId }) => {
      const currentId = id.parse(scenarioId);
      const scenario = await service.get(projectId, currentId);
      const against = new URL(request.url).searchParams.get("against");
      return json({
        scenario,
        ...(against !== null
          ? {
              diff: await service.diff(projectId, id.parse(against), currentId),
            }
          : {}),
      });
    }),
    revert: execute(async (request, { projectId, id: scenarioId }) =>
      json(
        {
          scenario: await service.revert(
            projectId,
            id.parse(scenarioId),
            await readJsonBody(request, 64 * 1024),
          ),
        },
        201,
      ),
    ),
  };
}
