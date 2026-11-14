import type { SQL } from "drizzle-orm";
import { PgDialect } from "drizzle-orm/pg-core";
import { describe, expect, it, vi } from "vitest";
import { createPostgresSiteRunLoader } from "./site-runs-postgres";

vi.mock("server-only", () => ({}));
describe("Postgres site run projection", () => {
  it("queries only the project and run ID, reassembling separate canonical data/events", async () => {
    const execute = vi.fn<(query: SQL) => Promise<unknown>>(async () => [
      {
        data: { id: "run1", projectId: "project1" },
        events: [{ type: "arrived" }],
      },
    ]);
    const load = createPostgresSiteRunLoader(() => ({ execute }));
    expect(await load("project1", "run1")).toEqual({
      id: "run1",
      projectId: "project1",
      events: [{ type: "arrived" }],
    });
    const query = new PgDialect().sqlToQuery(execute.mock.calls[0]![0]!);
    expect(query.params).toEqual(["project1", "run1"]);
    expect(query.sql).toMatch(/WHERE project_id=\$1 AND id=\$2/);
    expect(query.sql).toContain("SELECT data,events");
  });
  it("returns null for no scoped record", async () => {
    expect(
      await createPostgresSiteRunLoader(() => ({ execute: async () => [] }))(
        "project1",
        "run1",
      ),
    ).toBeNull();
  });
});
