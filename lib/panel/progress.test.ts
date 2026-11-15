import { describe, expect, it } from "vitest";
import {
  createPanelResendBackoff,
  PANEL_MAX_STALLED_RESENDS,
  PanelInProgressBodySchema,
  panelProgressMessage,
  parsePanelProgress,
} from "./progress";

describe("Jev panel progress (HAC-155)", () => {
  it("round-trips the progress message used as an investigation reason", () => {
    const message = panelProgressMessage({
      completedPersonas: 12,
      totalPersonas: 400,
    });
    expect(message).toBe("Jev panel in progress (12/400 personas)");
    expect(parsePanelProgress(message)).toEqual({
      completedPersonas: 12,
      totalPersonas: 400,
    });
    expect(parsePanelProgress("Advancement time budget reached")).toBeNull();
    expect(parsePanelProgress(null)).toBeNull();
  });

  it("parses the 202 body", () => {
    expect(
      PanelInProgressBodySchema.safeParse({
        status: "in_progress",
        message: "x",
        completedPersonas: 1,
        totalPersonas: 2,
      }).success,
    ).toBe(true);
    expect(
      PanelInProgressBodySchema.safeParse({ status: "succeeded" }).success,
    ).toBe(false);
  });

  it("resends quickly while progressing, backs off while stalled, then gives up", () => {
    const backoff = createPanelResendBackoff();
    const at = (completedPersonas: number) =>
      backoff.next({ completedPersonas, totalPersonas: 100 });
    expect(at(10)).toBe(1000);
    expect(at(10)).toBe(2000);
    expect(at(10)).toBe(4000);
    expect(at(20)).toBe(1000);
    for (let i = 1; i < PANEL_MAX_STALLED_RESENDS; i++)
      expect(at(20)).not.toBeNull();
    expect(at(20)).toBeNull();
    backoff.reset();
    expect(at(0)).toBe(1000);
  });
});
