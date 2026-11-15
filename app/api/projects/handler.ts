import { newProjectId } from "@/lib/projects/ids";

/** HAC-136: `POST /api/projects` creates the project row a fresh brief is saved under. */
export type ProjectCreator = (project: {
  id: string;
  name: string;
}) => Promise<void>;

export const NEW_PROJECT_NAME = "New project";

const json = (body: unknown, status: number) =>
  Response.json(body, { status, headers: { "Cache-Control": "no-store" } });

export function createProjectsHandler(
  create: ProjectCreator,
  makeId: () => string = () => newProjectId(),
) {
  return async function POST() {
    const id = makeId();
    try {
      await create({ id, name: NEW_PROJECT_NAME });
    } catch {
      return json(
        {
          code: "PROJECTS_UNAVAILABLE",
          message: "A new project could not be started. Please try again.",
          field_errors: {},
        },
        503,
      );
    }
    return json({ id, name: NEW_PROJECT_NAME }, 201);
  };
}
