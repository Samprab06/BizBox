import "server-only";
import { and, eq } from "drizzle-orm";
import { z } from "zod";
import { getDb } from "@/lib/db/client";
import { layouts } from "@/lib/db/layout-schema";
import type { Layout } from "@/lib/contracts/layout";
import { LayoutInputError, parseLayout } from "./model";
import { createLayoutDiffHook } from "./diff";

export class LayoutRepositoryError extends Error {
  constructor(
    readonly code: "not_found" | "conflict" | "invalid",
    message: string,
  ) {
    super(message);
    this.name = "LayoutRepositoryError";
  }
}
export interface LayoutRepository {
  insert(projectId: string, layout: Layout): Promise<Layout>;
  get(projectId: string, layoutId: string): Promise<Layout | null>;
}
/** Preload scoped snapshots before invoking the scenario model's synchronous diff API. */
export async function loadLayoutDiffHook(
  repository: LayoutRepository,
  project: string,
  layoutIds: readonly (string | null)[],
) {
  const projectId = scope(project, "projectId");
  const ids = [
    ...new Set(
      layoutIds
        .filter((id): id is string => id !== null)
        .map((id) => scope(id, "layoutId")),
    ),
  ];
  const snapshots = await Promise.all(
    ids.map(async (id) => {
      const layout = await repository.get(projectId, id);
      if (!layout)
        throw new LayoutInputError({
          layoutId: [`Layout ${id} was not found in this project`],
        });
      return [id, layout] as const;
    }),
  );
  const byId = new Map(snapshots);
  return createLayoutDiffHook((id) => byId.get(id) ?? null);
}
const Scope = z.string().trim().min(1).max(200);
function scope(input: unknown, path: string): string {
  const parsed = Scope.safeParse(input);
  if (!parsed.success)
    throw new LayoutInputError({
      [path]: parsed.error.issues.map((i) => i.message),
    });
  return parsed.data;
}
function mapError(error: unknown): never {
  const wrapped = error as { code?: string; cause?: { code?: string } };
  const code = wrapped?.cause?.code ?? wrapped?.code;
  if (code === "23503")
    throw new LayoutRepositoryError(
      "not_found",
      "Project or parent layout in this project and site was not found",
    );
  if (code === "23505")
    throw new LayoutRepositoryError(
      "conflict",
      "Layout ID already exists; allocate a new version ID",
    );
  if (code === "23514" || code === "23001")
    throw new LayoutRepositoryError(
      "invalid",
      "Layout violates an immutable storage constraint",
    );
  throw error;
}
function fromRow(row: typeof layouts.$inferSelect): Layout {
  const layout = parseLayout(row.data);
  if (
    layout.layoutId !== row.id ||
    layout.siteId !== row.siteId ||
    layout.parentId !== row.parentId
  )
    throw new LayoutRepositoryError(
      "invalid",
      "Stored layout identity does not match its snapshot",
    );
  return layout;
}

/** Lazy adapter: importing or creating it does not open a database connection. */
export function createPostgresLayoutRepository(
  database: () => ReturnType<typeof getDb> = getDb,
): LayoutRepository {
  return {
    async insert(project, input) {
      const projectId = scope(project, "projectId"),
        layout = parseLayout(input);
      try {
        const [row] = await database()
          .insert(layouts)
          .values({
            id: layout.layoutId,
            projectId,
            siteId: layout.siteId,
            parentId: layout.parentId,
            data: layout,
          })
          .returning();
        if (!row)
          throw new LayoutRepositoryError(
            "invalid",
            "Layout insert returned no snapshot",
          );
        return fromRow(row);
      } catch (error) {
        return mapError(error);
      }
    },
    async get(project, id) {
      const projectId = scope(project, "projectId"),
        layoutId = scope(id, "layoutId");
      const [row] = await database()
        .select()
        .from(layouts)
        .where(and(eq(layouts.projectId, projectId), eq(layouts.id, layoutId)))
        .limit(1);
      return row ? fromRow(row) : null;
    },
  };
}
