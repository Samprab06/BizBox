import { randomUUID } from "node:crypto";
import postgres from "postgres";
import { drizzle } from "drizzle-orm/postgres-js";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { EvaluationRequestSchema } from "@/lib/contracts/evaluation";
import { getDb } from "@/lib/db/client";
import * as schema from "@/lib/db/schema";
import { liveComparisonRecord } from "@/tests/e2e/live-comparison-fixtures";
import { createPostgresInvestigationToolDependencies } from "./tools-postgres";
import { createInvestigationTools, toolArtifactId } from "./tools";
import { createPostgresInvestigationRepository } from "./jobs-postgres";
import {
  createInvestigationService,
  type InvestigationStepPlanner,
  type InvestigationMilestone,
} from "./jobs";

vi.mock("server-only", () => ({}));
const enabled =
  process.env.RUN_ORCHESTRATOR_DB_TESTS === "1" &&
  !!process.env.HAC23_TEST_DATABASE_URL;
describe.skipIf(!enabled)("orchestrator durable writes [local]", () => {
  let client: ReturnType<typeof postgres>;
  const projectId = "houston-coffee";
  const profileId = "profile-live-57";
  const token = randomUUID();
  beforeAll(() => {
    const url = new URL(process.env.HAC23_TEST_DATABASE_URL!);
    if (
      !["localhost", "127.0.0.1"].includes(url.hostname) ||
      !url.pathname.startsWith("/hac23_test_")
    )
      throw new Error(
        "Orchestrator DB tests require a dedicated loopback hac23_test_ database",
      );
    process.env.DATABASE_URL = url.toString();
    client = postgres(url.toString(), { max: 4, connect_timeout: 5 });
  });
  afterAll(async () => {
    if (client) {
      await getDb().$client.end({ timeout: 5 });
      await client.end({ timeout: 5 });
    }
  });

  it("reuses deterministic profile/comparison artifacts after a lost checkpoint, including concurrent snapshot saves", async () => {
    const deps = createPostgresInvestigationToolDependencies();
    const profile = (await deps.loadProfile(projectId, profileId))!;
    const signal = new AbortController().signal;
    const key = `profile:${token}`;
    const [before] =
      await client`SELECT count(*)::int AS n FROM profiles WHERE project_id=${projectId}`;
    const saved = await Promise.all([
      deps.saveProfile(projectId, profile, key, signal),
      deps.saveProfile(projectId, profile, key, signal),
    ]);
    expect(saved[0]?.id).toBe(toolArtifactId("profile", key));
    expect(saved[1]).toEqual(saved[0]);
    const [after] =
      await client`SELECT count(*)::int AS n FROM profiles WHERE project_id=${projectId}`;
    expect(after!.n).toBe(before!.n + 1);

    const assembled = {
      request: EvaluationRequestSchema.parse({
        ...liveComparisonRecord.evaluation.request,
        projectId,
        profileId,
        profileVersion: profile.version,
        demandSource: "huff",
        seeds: 1,
      }),
      findings: [],
      assumptions: {},
    };
    const assemble = vi.fn(async () => assembled);
    const tools = createInvestigationTools({
      ...deps,
      jevConfigured: false,
      assemble,
    });
    const repository = createPostgresInvestigationRepository(() =>
      drizzle(client, { schema }),
    );
    const service = createInvestigationService(repository);
    const job = await service.create({
      projectId,
      profileId,
      question: "Synthetic idempotency verification",
    });
    const ids = assembled.request.sites.map((site) => site.siteId);
    const milestones: InvestigationMilestone[] = [
      {
        investigationId: job.id,
        attempt: 1,
        seq: 0,
        tool: "search_sites",
        inputHash: "synthetic-search",
        summary: { output: { profileId, siteIds: ids } },
        createdAt: new Date().toISOString(),
      },
    ];
    const context = {
      job,
      milestones,
      signal,
      idempotencyKey: `comparison:${token}`,
    };
    const first = await tools.execute(
      "evaluate_sites",
      { site_ids: ids, demand_source: "huff" },
      context,
    );
    const second = await tools.execute(
      "evaluate_sites",
      { site_ids: ids, demand_source: "huff" },
      context,
    );
    expect(second.summary).toEqual(first.summary);
    expect(assemble).toHaveBeenCalledTimes(1);
    expect(
      await deps.comparisons.load(
        projectId,
        toolArtifactId("comparison", context.idempotencyKey),
      ),
    ).not.toBeNull();
  }, 30_000);

  it("checkpoints to real Postgres, survives a tool deadline and resumes the same unfinished key", async () => {
    const repository = createPostgresInvestigationRepository(() =>
      drizzle(client, { schema }),
    );
    const service = createInvestigationService(repository, {
      resumeToolTimeouts: true,
    });
    const job = await service.create({
      projectId,
      profileId,
      question: "Synthetic resume verification",
    });
    let pendingAttempts = 0;
    const keys: string[] = [];
    const planner: InvestigationStepPlanner = async ({ nextSeq }) => ({
      tool: nextSeq === 0 ? "search_sites" : "evaluate_sites",
      inputHash: `step-${nextSeq}`,
      execute: async ({
        signal,
        idempotencyKey,
      }): Promise<{
        summary: InvestigationMilestone["summary"];
        done?: boolean;
      }> => {
        keys.push(idempotencyKey);
        if (nextSeq === 0) return { summary: { completed: true } };
        if (++pendingAttempts === 1)
          await new Promise<void>((resolve) =>
            signal.addEventListener("abort", () => resolve(), { once: true }),
          );
        return { summary: { comparisonId: "synthetic" }, done: true };
      },
    });
    const first = await service.advance(job.id, planner, {
      maxDurationMs: 500,
    });
    expect(first).toMatchObject({ status: "running", attempt: 1 });
    expect(await repository.listMilestones(job.id)).toHaveLength(1);
    const resumed = createInvestigationService(
      createPostgresInvestigationRepository(() => drizzle(client, { schema })),
      { resumeToolTimeouts: true },
    );
    expect((await resumed.advance(job.id, planner)).status).toBe("succeeded");
    expect(keys).toHaveLength(3);
    expect(keys[1]).toBe(keys[2]);
    expect(await repository.listMilestones(job.id)).toHaveLength(2);
  }, 30_000);
});
