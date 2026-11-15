import { it, expect, vi } from "vitest";
vi.mock("server-only", () => ({}));
import { createSpatialDraft } from "@/lib/spatial";
import { liveComparisonRecord } from "@/tests/e2e/live-comparison-fixtures";
import { assessInteriorAffordability } from "@/lib/nessie/interior-assessment";
import { createNessieConsultantReader } from "@/lib/nessie/consultant";
import {
  interiorAffordabilityRequest,
  fetchInteriorAffordability,
} from "./interior-affordability";
import { createSpatialToolExecutor } from "@/lib/agent/spatial-tools";
import type { IntakeUiContext } from "@/lib/agent/ui-tools";
const record = liveComparisonRecord,
  projectId = record.evaluation.request.projectId,
  siteId = record.evaluation.request.sites[0]!.siteId;
const draft = createSpatialDraft({ projectId, siteId, city: "houston" });
const flow = {
  comparisonId: record.id,
  siteId,
  baseline: draft,
  draft,
  ranRevision: 0,
  reviewedRevision: 0,
};
async function response() {
  return assessInteriorAffordability(
    projectId,
    interiorAffordabilityRequest(flow),
    new AbortController().signal,
    {
      loadComparison: async () => record,
      currentProfileVersion: async () =>
        record.evaluation.request.profileVersion,
      readNessie: createNessieConsultantReader({ env: {} }),
      verifyPolicies: async () => true,
    },
  );
}
it("validates the exact current version and rejects a stale assessment", async () => {
  const assessment = await response(),
    input = interiorAffordabilityRequest(flow),
    signal = new AbortController().signal;
  expect(
    (
      await fetchInteriorAffordability(projectId, input, signal, async () =>
        Response.json(assessment),
      )
    ).status,
  ).toBe("unconfigured");
  await expect(
    fetchInteriorAffordability(projectId, input, signal, async () =>
      Response.json({ ...assessment, fingerprint: "0".repeat(64) }),
    ),
  ).rejects.toThrow(/different experiment/);
  expect(() =>
    interiorAffordabilityRequest({ ...flow, reviewedRevision: null }),
  ).toThrow();
});
it("FDE accepts only server-computed affordability and invalidates review after editing", async () => {
  const assessment = await response(),
    read = vi.fn(async () => assessment);
  const context: IntakeUiContext = {
    projectId,
    actions: [],
    newId: () => "nessie-action",
    lookups: {
      site: async () => ({ city: "Houston" }),
      comparisonExists: async () => true,
      investigationExists: async () => false,
    },
    view: {
      stage: "interior",
      siteId,
      comparisonId: record.id,
      spatial: {
        comparisonId: record.id,
        baseline: draft,
        draft,
        reviewed: true,
      },
    },
    readInteriorAffordability: read,
  };
  const run = createSpatialToolExecutor(context);
  expect(
    JSON.parse(await run("read_interior_affordability", { siteId })).source,
  ).toBe("nessie");
  expect(context.actions[0]).toMatchObject({
    type: "set_interior_affordability",
    assessment: { fingerprint: assessment.fingerprint },
  });
  expect(
    await run("read_interior_affordability", { siteId, balance: 100000 }),
  ).toMatch(/^Error:/);
  await run("edit_interior", { siteId, command: { type: "clear" } });
  expect(await run("read_interior_affordability", { siteId })).toMatch(
    /^Error:.*Review/,
  );
  expect(read).toHaveBeenCalledTimes(1);
});
