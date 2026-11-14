import { describe, expect, it } from "vitest";
import { withoutNessieFindings, type NessieFindingMilestone } from "./findings";
const step = (
  tool: string,
  seq: number,
  summary: unknown,
  attempt = 1,
): NessieFindingMilestone => ({
  investigationId: "job1",
  attempt,
  seq,
  tool,
  summary,
});
describe("Nessie finding attribution", () => {
  it("removes saved bank messages/tool findings and subsequent model-derived notes while retaining unrelated evidence", () => {
    const milestones = [
      step("search_sites", 0, {
        toolFindings: ["Useful verified location evidence"],
        modelFindings: ["Pre-bank model note"],
      }),
      step("read_nessie_cash_buffer", 1, {
        output: { message: "Old available cash" },
        toolFindings: ["Old financial arithmetic"],
        modelFindings: ["Model says affordable"],
      }),
      step("get_site_run", 2, {
        toolFindings: ["Useful wait evidence"],
        modelFindings: ["Derived old cash reassurance"],
      }),
      step("finish_investigation", 3, {
        output: { findings: ["Final modeled cash summary"] },
        modelFindings: ["Final modeled cash summary"],
      }),
    ];
    const notes = [
      "Useful verified location evidence",
      "Useful wait evidence",
      "Pre-bank model note",
      "Old available cash",
      "Old financial arithmetic",
      "Model says affordable",
      "Derived old cash reassurance",
      "Final modeled cash summary",
    ];
    expect(withoutNessieFindings(notes, milestones.reverse())).toEqual([
      "Useful verified location evidence",
      "Useful wait evidence",
      "Pre-bank model note",
    ]);
  });
  it("does not attribute a new attempt's unrelated model notes to a previous attempt's bank read", () => {
    const milestones = [
      step("read_nessie_cash_buffer", 1, { toolFindings: ["Old bank"] }),
      step("search_sites", 0, { modelFindings: ["New location note"] }, 2),
    ];
    expect(
      withoutNessieFindings(["Old bank", "New location note"], milestones),
    ).toEqual(["New location note"]);
  });
  it("fails safely on malformed optional envelopes without deleting nonfinancial findings", () => {
    expect(
      withoutNessieFindings(
        ["Useful"],
        [
          step("read_nessie_cash_buffer", 1, "malformed"),
          step("finish_investigation", 2, { modelFindings: null }),
        ],
      ),
    ).toEqual(["Useful"]);
  });
});
