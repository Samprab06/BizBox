import { describe, expect, it } from "vitest";
import { isGeneratedProjectId } from "@/lib/projects/ids";
import { createProjectsHandler, NEW_PROJECT_NAME } from "./handler";

describe("POST /api/projects", () => {
  it("creates a project row under a generated ID and returns it", async () => {
    const rows: { id: string; name: string }[] = [];
    const response = await createProjectsHandler(async (row) => {
      rows.push(row);
    })();
    expect(response.status).toBe(201);
    expect(response.headers.get("Cache-Control")).toBe("no-store");
    const body = (await response.json()) as { id: string; name: string };
    expect(isGeneratedProjectId(body.id)).toBe(true);
    expect(body.name).toBe(NEW_PROJECT_NAME);
    expect(rows).toEqual([{ id: body.id, name: NEW_PROJECT_NAME }]);
  });

  it("gives every call its own ID", async () => {
    const handler = createProjectsHandler(async () => {});
    const ids = await Promise.all(
      Array.from({ length: 20 }, async () => {
        const body = (await (await handler()).json()) as { id: string };
        return body.id;
      }),
    );
    expect(new Set(ids).size).toBe(ids.length);
  });

  it("answers 503 without detail when the database is unavailable", async () => {
    const response = await createProjectsHandler(async () => {
      throw new Error("Database configuration is required.");
    })();
    expect(response.status).toBe(503);
    const body = await response.json();
    expect(body).toMatchObject({ code: "PROJECTS_UNAVAILABLE" });
    expect(JSON.stringify(body)).not.toContain("Database configuration");
  });
});
