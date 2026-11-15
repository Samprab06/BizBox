import { describe, expect, it } from "vitest";
import { projectMapFromPath } from "./project-recovery";

describe("project not-found recovery", () => {
  it.each(["houston-coffee", "p-0123456789abcdef0123", "houston%2Dcoffee"])(
    "keeps the current project in %s",
    (id) => {
      expect(projectMapFromPath(`/projects/${id}/sites/bogus`)).toBe(
        `/projects/${decodeURIComponent(id)}/map`,
      );
    },
  );
  it.each([
    null,
    "/does-not-exist",
    "/projects/",
    "/projects/%ZZ/sites/bogus",
    "/projects/../sites/bogus",
    "/projects/a%2Fb/sites/bogus",
    `/projects/${"x".repeat(201)}/sites/bogus`,
  ])(
    "uses home rather than an unsafe or unavailable project from %s",
    (path) => {
      expect(projectMapFromPath(path)).toBeUndefined();
    },
  );
});
