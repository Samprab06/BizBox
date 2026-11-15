import { writeFileSync } from "node:fs";
import { describe, expect, it, vi } from "vitest";
vi.mock("server-only", () => ({}));
import { formatEvalReport, runEvalSuite } from "./harness";

// Paid provider calls are opt-in: a key alone never enables them in routine test runs.
const enabled =
  process.env.RUN_OPENAI_LIVE === "1" && !!process.env.OPENAI_API_KEY?.trim();

describe("copilot evals [live]", () => {
  it.skipIf(!enabled)(
    "scores the configured OPENAI_MODEL on the same scripted requests",
    async () => {
      const { configuredCopilotDecisionModel } =
        await import("../copilot-model");
      const model = process.env.OPENAI_MODEL?.trim() || "default model";
      const report = await runEvalSuite(
        () => configuredCopilotDecisionModel,
        `Live: ${model}`,
      );
      const markdown = formatEvalReport(report);
      console.log(markdown);
      const out = process.env.EVAL_REPORT_PATH?.trim();
      if (out) writeFileSync(out, markdown);
      // Live accuracy is reported, not gated: the offline suite is the CI check.
      expect(report.cases).toBeGreaterThan(0);
    },
    20 * 60_000,
  );
});
