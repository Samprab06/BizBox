import { z } from "zod";
import { SiteRunSchema } from "@/lib/contracts";
import { invalid, json, notFound, unavailable } from "@/lib/evaluation/http";

const InputSchema = z.object({
  projectId: z.string().trim().min(1).max(200),
  runId: z
    .string()
    .min(1)
    .max(512)
    .regex(/^[A-Za-z0-9][A-Za-z0-9._:-]*$/),
});
const privateResponse = (response: Response) => {
  response.headers.set("Cache-Control", "private, no-store");
  return response;
};
export type SiteRunLoader = (
  projectId: string,
  runId: string,
) => Promise<unknown | null>;

export function createSiteRunReadHandler(loadRun: SiteRunLoader) {
  return async function GET(request: Request, rawRunId: string) {
    let input: z.infer<typeof InputSchema>;
    try {
      const projects = new URL(request.url).searchParams.getAll("projectId");
      if (projects.length !== 1)
        throw new Error("Provide exactly one projectId.");
      // Next can preserve percent escapes in route params; decode one component
      // once, then reject remaining escapes, slashes and malformed identifiers.
      input = InputSchema.parse({
        projectId: projects[0],
        runId: decodeURIComponent(rawRunId),
      });
    } catch (error) {
      return privateResponse(
        invalid(
          "INVALID_SITE_RUN",
          "Provide a valid projectId and run identifier.",
          error,
        ),
      );
    }
    try {
      const stored = await loadRun(input.projectId, input.runId);
      if (stored === null)
        return privateResponse(
          notFound("SITE_RUN_NOT_FOUND", "No such stored site run."),
        );
      const run = SiteRunSchema.parse(stored);
      // Defense in depth: even an incorrectly implemented injected reader cannot
      // expose a run from a different scope or substitute another run identifier.
      if (run.projectId !== input.projectId || run.id !== input.runId)
        return privateResponse(
          notFound("SITE_RUN_NOT_FOUND", "No such stored site run."),
        );
      return privateResponse(json({ run }, 200));
    } catch {
      return privateResponse(
        unavailable(
          "SITE_RUN_UNAVAILABLE",
          "The stored site run could not be loaded. Please try again.",
        ),
      );
    }
  };
}
