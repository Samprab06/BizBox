import { randomUUID } from "node:crypto";
import postgres from "postgres";
import { drizzle } from "drizzle-orm/postgres-js";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import * as schema from "@/lib/db/schema";
import { createPostgresProfileStore } from "@/lib/profiles/store-postgres";
import { assembleEvaluation } from "@/lib/evaluation/assemble";
import { createPostgresAssemblyDependencies } from "@/lib/evaluation/assemble-db";
import { createPostgresComparisonStore } from "@/lib/evaluation/store-postgres";
import {
  createComparisonsHandler,
  createComparisonReadHandler,
} from "./handler";

vi.mock("server-only", () => ({}));
const enabled =
  process.env.RUN_ASSEMBLY_DB_TESTS === "1" &&
  !!process.env.HAC56_TEST_DATABASE_URL;

describe.skipIf(!enabled)("comparison shortcut Postgres [local]", () => {
  let client: ReturnType<typeof postgres>;
  let handler: ReturnType<typeof createComparisonsHandler>;
  let read: ReturnType<typeof createComparisonReadHandler>;
  const created: string[] = [];
  const projectId = "houston-coffee";
  const profileId =
    process.env.HAC56_TEST_PROFILE_ID ?? "hac56-local-coffee-v1";
  const candidateIds = (
    process.env.HAC56_TEST_CANDIDATE_IDS ??
    "27478819:20881984,40263575:20962385,27478819:20056061"
  ).split(",");
  const post = (body: unknown) =>
    new Request("http://test/api/comparisons", {
      method: "POST",
      body: JSON.stringify(body),
    });

  beforeAll(async () => {
    const url = new URL(process.env.HAC56_TEST_DATABASE_URL!);
    if (
      !["localhost", "127.0.0.1"].includes(url.hostname) ||
      !url.pathname.startsWith("/hac56_test_")
    )
      throw new Error(
        "Comparison DB tests require a dedicated loopback hac56_test_ database",
      );
    client = postgres(url.toString(), { max: 4, connect_timeout: 5 });
    const db = drizzle(client, { schema });
    const store = createPostgresComparisonStore(() => db);
    handler = createComparisonsHandler({
      store,
      profiles: createPostgresProfileStore(() => db),
      assemble: (input) =>
        assembleEvaluation(
          input,
          createPostgresAssemblyDependencies(db, projectId),
        ),
      newId: () => {
        const id = `hac56_route_${randomUUID()}`;
        created.push(id);
        return id;
      },
    });
    read = createComparisonReadHandler({ store });
  });
  afterAll(async () => {
    if (client) {
      for (const id of created)
        await client`DELETE FROM comparisons WHERE project_id=${projectId} AND id=${id}`;
      await client.end({ timeout: 5 });
    }
  });

  it("assembles three real listing IDs, stores the comparison and reruns identical ranked metrics", async () => {
    const response = await handler(
      post({
        projectId,
        profileId,
        candidateIds,
        demandSource: "huff",
        seeds: 1,
      }),
    );
    expect(response.status).toBe(201);
    const body = await response.json();
    expect(new Set(body.result.ranking)).toEqual(new Set(candidateIds));
    expect(body.comparison.synthetic).toBe(true); // Local public catchment rows are synthetic fixtures.
    expect(Object.keys(body.assembly.assumptions).length).toBeGreaterThan(0);
    const loaded = await read(
      new Request(
        `http://test/api/comparisons/${body.comparisonId}?projectId=${projectId}`,
      ),
      body.comparisonId,
    );
    expect((await loaded.json()).assembly).toEqual(body.assembly);
    const rerun = await handler(
      post({ projectId, rerunComparisonId: body.comparisonId }),
    );
    expect(rerun.status).toBe(201);
    expect(await rerun.json()).toMatchObject({
      reproduces: true,
      assembly: body.assembly,
    });
  }, 60_000);
});
