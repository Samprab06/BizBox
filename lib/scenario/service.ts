import { createHash } from "node:crypto";
import { isDeepStrictEqual } from "node:util";
import { z } from "zod";
import {
  ScenarioAuthorSchema,
  ScenarioOverridesSchema,
  type Scenario,
} from "@/lib/contracts/scenario";
import type { ScenarioRepository } from "./repository";
import {
  createRootScenario,
  deriveScenario,
  diffScenarios,
  parseScenario,
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

/** Trusted retry metadata, separate from the user-controlled scenario payload. */
export interface CreateScenarioOptions {
  idempotencyKey?: string;
}

function retryId(projectId: string, key: string): string {
  const hex = createHash("sha256")
    .update(JSON.stringify(["scenario-create:v1", projectId, key]))
    .digest("hex");
  // UUID version/variant bits keep deterministic IDs acceptable to UUID columns.
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-8${hex.slice(13, 16)}-${((parseInt(hex[16], 16) & 3) | 8).toString(16)}${hex.slice(17, 20)}-${hex.slice(20, 32)}`;
}

function uniqueViolation(error: unknown): boolean {
  if (!error || typeof error !== "object") return false;
  if ("code" in error && error.code === "23505") return true;
  if (
    error instanceof Error &&
    error.name === "ScenarioRepositoryError" &&
    "code" in error &&
    error.code === "conflict"
  )
    return true;
  return (
    "cause" in error && error.cause !== error && uniqueViolation(error.cause)
  );
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
    async create(
      projectId: string,
      raw: unknown,
      options?: CreateScenarioOptions,
    ): Promise<Scenario> {
      const input = CreateScenarioSchema.parse(raw);
      const project = identity(projectId);
      const key = options?.idempotencyKey;
      if (key !== undefined) {
        z.string()
          .min(1)
          .max(2000)
          .refine((v) => !!v.trim())
          .parse(key);
        const fixedMeta = {
          id: retryId(project, key),
          createdAt: now().toISOString(),
          author: input.author,
          rationale: input.rationale,
        };
        const expected =
          "fromId" in input
            ? deriveScenario(
                await get(project, input.fromId),
                input.patch,
                fixedMeta,
              )
            : createRootScenario({
                ...input,
                ...fixedMeta,
                projectId: project,
              });
        const verify = (existing: Scenario) => {
          const parsed = parseScenario(existing);
          if (
            !isDeepStrictEqual(
              { ...parsed, createdAt: expected.createdAt },
              expected,
            )
          )
            throw new ScenarioServiceError(
              "invalid",
              "Retry key already belongs to a different scenario request",
            );
          return parsed;
        };
        const existing = await repository.get(project, expected.id);
        if (existing) return verify(existing);
        try {
          return "fromId" in input
            ? await repository.appendVersion(
                project,
                input.fromId,
                input.patch,
                fixedMeta,
              )
            : await repository.insert(expected);
        } catch (error) {
          if (!uniqueViolation(error)) throw error;
          const raced = await repository.get(project, expected.id);
          if (!raced) throw error;
          return verify(raced);
        }
      }
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
