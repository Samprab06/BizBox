import { z } from "zod";
import {
  ScenarioAuthorSchema,
  ScenarioOverridesSchema,
  type Scenario,
} from "@/lib/contracts/scenario";
import type { ScenarioRepository } from "./repository";
import {
  createRootScenario,
  diffScenarios,
  type LayoutDiffHook,
} from "./model";

const id = z.string().trim().min(1).max(200);
const fields = {
  siteIds: z.array(id).min(1).max(8),
  profileVersion: z.number().int().positive(),
  overrides: ScenarioOverridesSchema,
  layoutId: id.nullable(),
  label: z.string().trim().min(1).max(200),
};
const author = {
  author: ScenarioAuthorSchema.default("founder"),
  rationale: z.string().trim().min(1).max(8000).nullable().optional(),
};
export const CreateScenarioSchema = z.union([
  z
    .object({
      siteIds: fields.siteIds,
      profileVersion: fields.profileVersion,
      overrides: fields.overrides.optional(),
      layoutId: fields.layoutId.optional(),
      label: fields.label,
      ...author,
    })
    .strict(),
  z
    .object({
      fromId: id,
      patch: z.object(fields).partial().strict(),
      ...author,
    })
    .strict(),
]);
export const RevertScenarioSchema = z
  .object({ targetId: id, ...author })
  .strict();

export class ScenarioServiceError extends Error {
  constructor(
    readonly code: "not_found" | "invalid",
    message: string,
  ) {
    super(message);
    this.name = "ScenarioServiceError";
  }
}

/** History operations use the same immutable repository for UI and future tools. */
export function createScenarioService({
  repository,
  newId,
  now = () => new Date(),
  layoutDiff,
}: {
  repository: Pick<
    ScenarioRepository,
    "insert" | "get" | "list" | "appendVersion"
  >;
  newId: () => string;
  now?: () => Date;
  layoutDiff?: (
    projectId: string,
    layoutIds: readonly (string | null)[],
  ) => Promise<LayoutDiffHook>;
}) {
  const identity = (projectId: string) => id.parse(projectId);
  async function get(projectId: string, scenarioId: string): Promise<Scenario> {
    const scenario = await repository.get(
      identity(projectId),
      id.parse(scenarioId),
    );
    if (!scenario)
      throw new ScenarioServiceError(
        "not_found",
        "Scenario not found in this project",
      );
    return scenario;
  }
  const meta = (input: {
    author: Scenario["author"];
    rationale?: string | null;
  }) => ({
    id: newId(),
    createdAt: now().toISOString(),
    author: input.author,
    rationale: input.rationale,
  });
  return {
    get,
    async create(projectId: string, raw: unknown): Promise<Scenario> {
      const input = CreateScenarioSchema.parse(raw);
      const project = identity(projectId);
      if ("fromId" in input) {
        await get(project, input.fromId);
        return repository.appendVersion(
          project,
          input.fromId,
          input.patch,
          meta(input),
        );
      }
      return repository.insert(
        createRootScenario({
          ...input,
          ...meta(input),
          projectId: project,
        }),
      );
    },
    async list(projectId: string) {
      const scenarios = await repository.list(identity(projectId));
      return scenarios.map((scenario) => ({
        scenario,
        children: scenarios
          .filter((child) => child.parentId === scenario.id)
          .map((child) => child.id),
      }));
    },
    async diff(projectId: string, fromId: string, toId: string) {
      const [from, to] = await Promise.all([
        get(projectId, fromId),
        get(projectId, toId),
      ]);
      const hook = layoutDiff
        ? await layoutDiff(projectId, [from.layoutId, to.layoutId])
        : undefined;
      return diffScenarios(from, to, hook);
    },
    async revert(
      projectId: string,
      currentId: string,
      raw: unknown,
    ): Promise<Scenario> {
      const input = RevertScenarioSchema.parse(raw);
      const [current, target] = await Promise.all([
        get(projectId, currentId),
        get(projectId, input.targetId),
      ]);
      return repository.appendVersion(
        projectId,
        current.id,
        {
          siteIds: target.siteIds,
          profileVersion: target.profileVersion,
          overrides: target.overrides,
          layoutId: target.layoutId,
          label: target.label,
        },
        meta(input),
      );
    },
  };
}

export type ScenarioService = ReturnType<typeof createScenarioService>;
