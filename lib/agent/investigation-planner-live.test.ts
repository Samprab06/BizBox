import { describe, expect, it, vi } from "vitest";
import { createInvestigationService } from "./jobs";
import { createMemoryInvestigationRepository } from "./jobs-memory";
import { createConfiguredInvestigationPlanner } from "./investigation-planner";
import type { InvestigationToolRegistry } from "./tools";

vi.mock("server-only", () => ({}));
const enabled =
  process.env.RUN_INVESTIGATION_LIVE === "1" && !!process.env.OPENAI_API_KEY;

// Explicit opt-in only: this checks a real provider decision, never database or
// business-tool execution. The ordinary scripted tests cover the full workflow.
describe.skipIf(!enabled)("configured investigation decision [live]", () => {
  it("finishes a bounded provider smoke investigation with no available business tools", async () => {
    const repository = createMemoryInvestigationRepository();
    const service = createInvestigationService(repository);
    const job = await service.create({
      projectId: "synthetic-provider-smoke",
      profileId: "synthetic-profile",
      question:
        "Integration smoke test only. No business tools are available. Finish now with a finding saying that no location recommendation was made. Do not invent any facts.",
    });
    const execute = vi.fn<InvestigationToolRegistry["execute"]>();
    const planner = createConfiguredInvestigationPlanner({
      definitions: [],
      execute,
    });
    const plan = await planner({
      job,
      milestones: [],
      nextSeq: 0,
      signal: new AbortController().signal,
    });
    expect(plan?.tool).toBe("finish_investigation");
    const result = await plan!.execute({
      signal: new AbortController().signal,
      idempotencyKey: "synthetic-smoke-finish",
    });
    expect(result.done).toBe(true);
    expect(result.findings?.length).toBeGreaterThan(0);
    expect(execute).not.toHaveBeenCalled();
  }, 30_000);
});
