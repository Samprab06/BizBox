import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { syntheticHoustonFixture } from "@/fixtures/houston-coffee";
import { createPostgresAssemblyDependencies } from "@/lib/evaluation/assemble-db";
import {
  createAbortablePanelClient,
  createPostgresInvestigationToolDependencies,
} from "./tools-postgres";
import { toolArtifactId } from "./tools";

const mocks = vi.hoisted(() => ({
  load: vi.fn(),
  save: vi.fn(),
  ids: [] as string[],
}));
vi.mock("server-only", () => ({}));
vi.mock("@/lib/db/client", () => ({ getDb: () => ({}) }));
vi.mock("@/lib/profiles/store-postgres", () => ({
  createPostgresProfileStore: (_database?: unknown, id?: () => string) => ({
    load: mocks.load,
    saveSnapshot: (project: string, profile: unknown) => {
      if (id) mocks.ids.push(id());
      return mocks.save(project, profile);
    },
  }),
}));
vi.mock("@/lib/evaluation/store-postgres", () => ({
  createPostgresComparisonStore: () => ({}),
}));
vi.mock("@/lib/evaluation/assemble-db", () => ({
  createPostgresAssemblyDependencies: vi.fn(() => ({
    getCatchment: async () => ({ response: { competitors: [] } }),
  })),
}));
vi.mock("@/lib/evaluation/assemble", async (original) => ({
  ...(await original<typeof import("@/lib/evaluation/assemble")>()),
  assembleEvaluation: vi.fn(async () => ({
    request: {},
    findings: [],
    assumptions: {},
  })),
}));

beforeEach(() => {
  vi.clearAllMocks();
  mocks.ids.length = 0;
});
afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});

describe("production tool safety boundaries", () => {
  it("loads the deterministic profile artifact before saving another version", async () => {
    const profile = {
      ...syntheticHoustonFixture.profile,
      id: toolArtifactId("profile", "key"),
    };
    mocks.load.mockResolvedValue(profile);
    const deps = createPostgresInvestigationToolDependencies();
    expect(
      await deps.saveProfile(
        profile.projectId,
        profile,
        "key",
        new AbortController().signal,
      ),
    ).toEqual(profile);
    expect(mocks.load).toHaveBeenCalledWith(profile.projectId, profile.id);
    expect(mocks.save).not.toHaveBeenCalled();
  });
  it("recovers a committed profile after an insert conflict without a second artifact", async () => {
    const profile = {
      ...syntheticHoustonFixture.profile,
      id: toolArtifactId("profile", "same-key"),
    };
    mocks.load.mockResolvedValueOnce(null).mockResolvedValueOnce(profile);
    mocks.save.mockRejectedValue(new Error("duplicate deterministic ID"));
    const deps = createPostgresInvestigationToolDependencies();
    expect(
      await deps.saveProfile(
        profile.projectId,
        profile,
        "same-key",
        new AbortController().signal,
      ),
    ).toEqual(profile);
    expect(mocks.ids).toEqual([profile.id]);
    expect(mocks.save).toHaveBeenCalledTimes(1);
  });
  it("gives evaluation a cache-only client even when a paid provider is configured", async () => {
    vi.stubEnv("JEV_API_KEY", "configured-test-value");
    vi.stubEnv("JEV_MODEL", "configured-request-model");
    const deps = createPostgresInvestigationToolDependencies();
    await deps.assemble(
      syntheticHoustonFixture.profile,
      ["101:1"],
      { mode: "cache-only" },
      new AbortController().signal,
    );
    const client = vi.mocked(createPostgresAssemblyDependencies).mock
      .calls[0]![2]!;
    expect(client.modelVersion).toBe("configured-request-model");
    await expect(
      client.ask({
        state: { person: "test", need: "test", options: {} },
        questions: [],
      }),
    ).rejects.toThrow("paid calls are forbidden");
  });
  it("propagates a job cutoff into an already in-flight Jev fetch", async () => {
    const controller = new AbortController();
    let requestSignal: AbortSignal | null | undefined;
    const fetcher = vi.fn<typeof fetch>(async (_url, init) => {
      requestSignal = init?.signal;
      return new Promise<Response>((_resolve, reject) =>
        requestSignal!.addEventListener(
          "abort",
          () => reject(new DOMException("Aborted", "AbortError")),
          { once: true },
        ),
      );
    });
    const client = createAbortablePanelClient(
      controller.signal,
      {
        JEV_API_KEY: "test-value",
        JEV_BASE_URL: "https://example.test",
        JEV_MODEL: "test-model",
      },
      fetcher,
    );
    const pending = client.ask({
      state: { person: "test", need: "test", options: {} },
      questions: [],
    });
    await Promise.resolve();
    expect(fetcher).toHaveBeenCalledTimes(1);
    expect(requestSignal?.aborted).toBe(false);
    controller.abort(new Error("Job cutoff"));
    await expect(pending).rejects.toThrow("Job cutoff");
    expect(requestSignal?.aborted).toBe(true);
    expect(fetcher).toHaveBeenCalledTimes(1);
  });
});

it("wires the optional read-only Nessie transport into production investigation dependencies", async () => {
  vi.stubEnv("NESSIE_API_KEY", "test-v2-key");
  const fetcher = vi
    .fn<typeof fetch>()
    .mockResolvedValue(Response.json({ items: [] }));
  vi.stubGlobal("fetch", fetcher);
  const deps = createPostgresInvestigationToolDependencies();
  const controller = new AbortController();
  const result = await deps.readNessieCashBuffer!({
    investigationId: "job1",
    attempt: 1,
    projectId: "project1",
    profileId: "profile1",
    profileVersion: 1,
    signal: controller.signal,
  });
  expect(result).toMatchObject({
    kind: "nessie_cash_buffer",
    status: "empty",
    projectId: "project1",
    profileId: "profile1",
    attempt: 1,
  });
  expect(fetcher).toHaveBeenCalledWith(
    expect.any(URL),
    expect.objectContaining({
      method: "GET",
      headers: { Authorization: "Bearer test-v2-key" },
    }),
  );
  expect(fetcher).toHaveBeenCalledTimes(1);
});
