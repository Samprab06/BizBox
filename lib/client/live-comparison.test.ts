import { describe, expect, it, vi } from "vitest";
import { syntheticHoustonFixture } from "@/fixtures/houston-coffee";
import { liveComparisonPayload } from "@/tests/e2e/live-comparison-fixtures";
import {
  comparisonStorageKey,
  readSavedComparison,
  requestLiveComparison,
} from "./live-comparison";

const profile = {
  ...syntheticHoustonFixture.profile,
  projectId: liveComparisonPayload.result.projectId,
};
const snapshot = {
  ...profile,
  id: liveComparisonPayload.result.profileId,
  version: liveComparisonPayload.result.profileVersion,
};
const ids = liveComparisonPayload.result.sites.map((site) => site.siteId);

describe("live comparison requests", () => {
  it("saves a snapshot before evaluating only selected candidates and records the intake identity", async () => {
    const fetcher = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(
        Response.json({ profile: snapshot, persisted: true }),
      )
      .mockResolvedValueOnce(Response.json(liveComparisonPayload));
    const response = await requestLiveComparison(
      profile,
      ids,
      "huff",
      undefined,
      fetcher,
    );
    expect(fetcher.mock.calls.map(([url]) => url)).toEqual([
      "/api/profiles",
      "/api/comparisons",
    ]);
    expect(JSON.parse(fetcher.mock.calls[1]![1]!.body as string)).toEqual({
      projectId: profile.projectId,
      profileId: snapshot.id,
      candidateIds: ids,
      demandSource: "huff",
    });
    expect(response.saved.intakeFingerprint).toBe(JSON.stringify(profile));
    expect(response.saved.profileId).toBe(snapshot.id);
  });

  it("does not create comparisons after failed or cross-project snapshot saves", async () => {
    const failing = vi
      .fn<typeof fetch>()
      .mockResolvedValue(Response.json({}, { status: 503 }));
    await expect(
      requestLiveComparison(profile, ids, "huff", undefined, failing),
    ).rejects.toThrow();
    expect(failing).toHaveBeenCalledTimes(1);
    const wrongProject = vi.fn<typeof fetch>().mockResolvedValue(
      Response.json({
        profile: { ...snapshot, projectId: "other" },
        persisted: true,
      }),
    );
    await expect(
      requestLiveComparison(profile, ids, "huff", undefined, wrongProject),
    ).rejects.toThrow("identity");
    expect(wrongProject).toHaveBeenCalledTimes(1);
  });

  it("rejects cross-profile results and unselected site rows", async () => {
    const response = (payload: unknown) =>
      vi
        .fn<typeof fetch>()
        .mockResolvedValueOnce(
          Response.json({ profile: snapshot, persisted: true }),
        )
        .mockResolvedValueOnce(Response.json(payload));
    await expect(
      requestLiveComparison(
        profile,
        ids,
        "jev",
        undefined,
        response({
          ...liveComparisonPayload,
          result: { ...liveComparisonPayload.result, profileId: "different" },
        }),
      ),
    ).rejects.toThrow("identity");
    await expect(
      requestLiveComparison(
        profile,
        ids.slice(0, 1),
        "huff",
        undefined,
        response(liveComparisonPayload),
      ),
    ).rejects.toThrow("identity");
  });

  it("resends the same body on 202 in_progress with backoff, reporting progress, until the comparison arrives (HAC-155)", async () => {
    const inProgress = (completedPersonas: number) =>
      Response.json(
        {
          status: "in_progress",
          message: `Jev panel in progress (${completedPersonas}/400 personas)`,
          completedPersonas,
          totalPersonas: 400,
        },
        { status: 202 },
      );
    const fetcher = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(
        Response.json({ profile: snapshot, persisted: true }),
      )
      .mockResolvedValueOnce(inProgress(100))
      .mockResolvedValueOnce(inProgress(100))
      .mockResolvedValueOnce(inProgress(260))
      .mockResolvedValueOnce(Response.json(liveComparisonPayload));
    const progress: unknown[] = [];
    const waits: number[] = [];
    const response = await requestLiveComparison(
      profile,
      ids,
      "jev",
      undefined,
      fetcher,
      {
        onProgress: (p) => progress.push(p),
        sleep: async (ms) => {
          waits.push(ms);
        },
      },
    );
    expect(response.payload.comparisonId).toBe(
      liveComparisonPayload.comparisonId,
    );
    const bodies = fetcher.mock.calls
      .slice(1)
      .map(([, init]) => JSON.parse(init!.body as string));
    expect(bodies).toHaveLength(4);
    for (const body of bodies) expect(body).toEqual(bodies[0]);
    expect(progress).toEqual([
      { completedPersonas: 100, totalPersonas: 400 },
      { completedPersonas: 100, totalPersonas: 400 },
      { completedPersonas: 260, totalPersonas: 400 },
    ]);
    // Progress resets the backoff; a resend without new personas doubles it.
    expect(waits).toEqual([1000, 2000, 1000]);
  });

  it("gives up when the panel stops making progress", async () => {
    const stuck = () =>
      Response.json(
        {
          status: "in_progress",
          message: "Jev panel in progress (5/400 personas)",
          completedPersonas: 5,
          totalPersonas: 400,
        },
        { status: 202 },
      );
    const fetcher = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(
        Response.json({ profile: snapshot, persisted: true }),
      )
      .mockImplementation(async () => stuck());
    await expect(
      requestLiveComparison(profile, ids, "jev", undefined, fetcher, {
        sleep: async () => {},
      }),
    ).rejects.toThrow("not making progress");
    expect(fetcher).toHaveBeenCalledTimes(1 + 6);
  });

  it("requires a distinct bounded selection before writing a snapshot", async () => {
    const fetcher = vi.fn<typeof fetch>();
    for (const selection of [
      [],
      [ids[0]!, ids[0]!],
      ["bad"],
      Array.from({ length: 9 }, (_, n) => `${n}:${n}`),
    ])
      await expect(
        requestLiveComparison(profile, selection, "huff", undefined, fetcher),
      ).rejects.toThrow();
    expect(fetcher).not.toHaveBeenCalled();
  });
});

describe("saved comparison identity", () => {
  const saved = {
    projectId: "p1",
    comparisonId: "cmp",
    profileId: "profile",
    profileVersion: 1,
    intakeFingerprint: "intake",
  };
  it("accepts only valid records in the requested project", () => {
    const storage = { getItem: vi.fn(() => JSON.stringify(saved)) };
    expect(readSavedComparison(storage, "p1")).toEqual(saved);
    expect(storage.getItem).toHaveBeenCalledWith(comparisonStorageKey("p1"));
    expect(readSavedComparison(storage, "p2")).toBeNull();
  });
  it("recovers from malformed records and denied storage", () => {
    expect(readSavedComparison({ getItem: () => "{" }, "p1")).toBeNull();
    expect(
      readSavedComparison(
        {
          getItem: () => {
            throw new Error("denied");
          },
        },
        "p1",
      ),
    ).toBeNull();
  });
});
