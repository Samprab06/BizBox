import { describe, expect, it } from "vitest";
import {
  DEMO_PROJECT_ID,
  isGeneratedProjectId,
  isKnownProjectId,
  newProjectId,
} from "./ids";
import { getPreviewProject } from "@/lib/workspace-preview";

describe("project ids", () => {
  it("formats 80 random bits as p- and lowercase hex", () => {
    expect(
      newProjectId(
        () => new Uint8Array([0, 1, 2, 171, 255, 16, 9, 10, 11, 12]),
      ),
    ).toBe("p-000102abff10090a0b0c");
    expect(isGeneratedProjectId(newProjectId())).toBe(true);
  });

  it("recognises generated ids and the demo project, nothing else", () => {
    expect(isKnownProjectId(DEMO_PROJECT_ID)).toBe(true);
    expect(isKnownProjectId(newProjectId())).toBe(true);
    for (const id of [
      "no-such-project",
      "p-123",
      "P-000102ABFF10090A0B0C",
      "p-000102abff10090a0b0c/x",
      "",
    ])
      expect(isKnownProjectId(id)).toBe(false);
  });

  it("resolves a created project without example sites, and the demo with them", () => {
    const id = newProjectId();
    expect(getPreviewProject(id)).toMatchObject({ id, sites: [] });
    expect(getPreviewProject(DEMO_PROJECT_ID)?.sites.map((s) => s.id)).toEqual([
      "montrose",
      "heights",
    ]);
    expect(getPreviewProject("no-such-project")).toBeNull();
  });
});
