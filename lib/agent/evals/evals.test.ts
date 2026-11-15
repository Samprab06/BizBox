import { describe, expect, it, vi } from "vitest";
vi.mock("server-only", () => ({}));
import { EVAL_CASES } from "./cases";
import { formatEvalReport, runEvalSuite, scriptedModel } from "./harness";

describe("copilot evals [offline, scripted model]", () => {
  it("has about twenty founder requests with unique IDs", () => {
    expect(EVAL_CASES.length).toBeGreaterThanOrEqual(20);
    expect(new Set(EVAL_CASES.map((c) => c.id)).size).toBe(EVAL_CASES.length);
  });

  it("every scripted request produces the expected tool calls, scenario diffs and guard result", async () => {
    const fetchSpy = vi.spyOn(globalThis, "fetch");
    const report = await runEvalSuite(
      (workspace, testCase) => scriptedModel(testCase.script, workspace),
      "Scripted model (offline)",
    );
    const failures = report.results.filter(
      (r) => !r.toolCallsCorrect || !r.diffsCorrect || !r.guardCorrect,
    );
    expect(failures).toEqual([]);
    expect(report.toolCallAccuracy).toBe(1);
    expect(report.diffAccuracy).toBe(1);
    expect(report.guardAccuracy).toBe(1);
    expect(fetchSpy).not.toHaveBeenCalled();
    expect(formatEvalReport(report)).toContain("Tool-call accuracy: 100.0%");
    if (process.env.PRINT_EVAL_REPORT === "1")
      console.log(formatEvalReport(report));
    fetchSpy.mockRestore();
  }, 120_000);

  it("scores a wrong model as wrong: the harness is not vacuous", async () => {
    const [first] = EVAL_CASES;
    const report = await runEvalSuite(
      (workspace) =>
        scriptedModel(
          [
            {
              tool: "set_stations",
              args: { scenario_id: "$BASE", n: 4, rationale: "Wrong." },
            },
          ],
          workspace,
        ),
      "Wrong model",
      [first],
    );
    expect(report.toolCallAccuracy).toBe(0);
    expect(report.diffAccuracy).toBe(0);
  });
});
