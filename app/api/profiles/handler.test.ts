import { describe, expect, it, vi } from "vitest";
import { syntheticHoustonFixture } from "@/fixtures/houston-coffee";
import { createProfilesHandler } from "./handler";

const profile = syntheticHoustonFixture.profile;
const post = (body: unknown) =>
  new Request("http://test/api/profiles", {
    method: "POST",
    body: JSON.stringify(body),
  });

describe("POST /api/profiles", () => {
  it("returns the authoritative immutable snapshot from the store", async () => {
    const saved = { ...profile, id: "profile_saved", version: 2 };
    const save = vi.fn(async () => saved);
    const response = await createProfilesHandler({
      saveSnapshot: save,
      load: vi.fn(),
    })(post({ projectId: profile.projectId, profile }));
    expect(response.status).toBe(201);
    expect(response.headers.get("Cache-Control")).toBe("no-store");
    expect(await response.json()).toEqual({ profile: saved, persisted: true });
    expect(save).toHaveBeenCalledWith(profile.projectId, profile);
  });

  it("rejects mismatched project identities and invalid profiles before storage", async () => {
    const save = vi.fn();
    const handler = createProfilesHandler({
      saveSnapshot: save,
      load: vi.fn(),
    });
    expect((await handler(post({ projectId: "other", profile }))).status).toBe(
      422,
    );
    expect(
      (await handler(post({ projectId: profile.projectId, profile: {} })))
        .status,
    ).toBe(422);
    expect(save).not.toHaveBeenCalled();
  });

  it("reports missing projects and safe storage failures", async () => {
    const save = vi
      .fn()
      .mockResolvedValueOnce(null)
      .mockRejectedValueOnce(new Error("private database detail"));
    const handler = createProfilesHandler({
      saveSnapshot: save,
      load: vi.fn(),
    });
    expect(
      (await handler(post({ projectId: profile.projectId, profile }))).status,
    ).toBe(404);
    const failed = await handler(
      post({ projectId: profile.projectId, profile }),
    );
    expect(failed.status).toBe(503);
    expect(JSON.stringify(await failed.json())).not.toContain(
      "private database detail",
    );
  });
});
