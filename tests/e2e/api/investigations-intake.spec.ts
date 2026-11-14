import { z } from "zod";
import { expect, test } from "@playwright/test";
import { BusinessProfileSchema } from "../../../lib/contracts";
import {
  InvestigationJobSchema,
  InvestigationMilestoneSchema,
} from "../../../lib/contracts/investigations";
import {
  PROJECT_ID,
  WITH_DB,
  WITH_MODEL,
  expectClientError,
  expectNoSecrets,
  testProfile,
} from "./helpers";

const JobResponse = z.object({
  job: InvestigationJobSchema,
  milestones: z.array(InvestigationMilestoneSchema),
});

test.describe("validation (no database needed)", () => {
  test("investigations reject bad input without a 500", async ({ request }) => {
    await expectClientError(
      await request.post("/api/investigations", { data: {} }),
    );
    await expectClientError(
      await request.post("/api/investigations", {
        data: { projectId: PROJECT_ID, profileId: "p", question: "" },
      }),
    );
    await expectClientError(
      await request.post("/api/investigations/x/advance", {
        data: { action: "explode" },
      }),
    );
  });

  test("intake rejects bad input without a 500", async ({ request }) => {
    await expectClientError(
      await request.post(`/api/projects/${PROJECT_ID}/intake`, {
        data: { bogus: 1 },
      }),
    );
    await expectClientError(
      await request.post(`/api/projects/${PROJECT_ID}/intake`, {
        data: { patch: { city: "Atlantis" } },
      }),
    );
  });
});

test.describe("happy paths (E2E_DB=1)", () => {
  test.skip(!WITH_DB, "needs a loaded database (E2E_DB=1)");

  test("an investigation is created, read back, and unknown IDs are 404", async ({
    request,
  }) => {
    const saved = z
      .object({ profile: BusinessProfileSchema })
      .parse(
        await (
          await request.post("/api/profiles", {
            data: { projectId: PROJECT_ID, profile: testProfile() },
          })
        ).json(),
      );
    const created = await request.post("/api/investigations", {
      data: {
        projectId: PROJECT_ID,
        profileId: saved.profile.id,
        question: "Where should this coffee shop open?",
      },
    });
    expect(created.status()).toBe(201);
    const job = JobResponse.parse(await created.json()).job;
    expect(job.status).toBe("queued");
    await expectNoSecrets(created);

    const read = await request.get(`/api/investigations/${job.id}`);
    expect(read.status()).toBe(200);
    expect(JobResponse.parse(await read.json()).job.id).toBe(job.id);
    expect(
      (await request.get("/api/investigations/no-such-job")).status(),
    ).toBe(404);
    expect(
      (
        await request.post("/api/investigations/no-such-job/advance", {
          data: {},
        })
      ).status(),
    ).toBe(404);

    // Advancing runs the OpenAI planner; only when explicitly enabled.
    if (WITH_MODEL) {
      let state = JobResponse.parse(await read.json());
      for (
        let i = 0;
        i < 25 && ["queued", "running"].includes(state.job.status);
        i++
      ) {
        const step = await request.post(
          `/api/investigations/${job.id}/advance`,
          { data: {}, timeout: 60_000 },
        );
        expect([200, 503]).toContain(step.status());
        if (step.status() !== 200) break;
        state = JobResponse.parse(await step.json());
      }
      expect(["succeeded", "failed"]).toContain(state.job.status);
      const again = await request.post(
        `/api/investigations/${job.id}/advance`,
        { data: {} },
      );
      expect(JobResponse.parse(await again.json()).job.status).toBe(
        state.job.status,
      );
    }
  });

  test("a structured intake patch needs no model and returns the draft", async ({
    request,
  }) => {
    const response = await request.post(`/api/projects/${PROJECT_ID}/intake`, {
      data: { patch: { city: "Houston" } },
    });
    expect(response.status()).toBe(200);
    const body = await response.json();
    expect(body.persisted).toBe(false);
    expect(body.draft.city).toBe("Houston");
    await expectNoSecrets(response);
  });
});
