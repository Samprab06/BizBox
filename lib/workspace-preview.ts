import { previewProjectSchema } from "./contracts/workspace-preview";
import { demoPreviewProject } from "@/fixtures/demo-project";
import { DEMO_PROJECT_ID, isGeneratedProjectId } from "./projects/ids";

/**
 * The workspace's view of a project. The demo project carries its example sites; a
 * created project (HAC-136) starts with none: its candidates come from the live search
 * of the founder's own brief. Unknown IDs return null.
 */
export function getPreviewProject(projectId: string) {
  if (projectId === DEMO_PROJECT_ID)
    return previewProjectSchema.parse(demoPreviewProject);
  if (!isGeneratedProjectId(projectId)) return null;
  return previewProjectSchema.parse({
    id: projectId,
    name: "Your project",
    // The founder's brief supplies city and business (workspaceHeader reads it first).
    city: "",
    business: "",
    sites: [],
  });
}
