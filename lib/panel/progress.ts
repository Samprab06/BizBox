/**
 * HAC-155: the wire shape and wording of a deadline-limited Jev panel. Client-safe (no server
 * imports): the API routes, `lib/client/live-comparison.ts` and `ConsultantPanel` all use it,
 * so a partial panel is reported the same way everywhere and is never shown as a result.
 */
import { z } from "zod";

export type PanelProgressCount = {
  completedPersonas: number;
  totalPersonas: number;
};

const PREFIX = "Jev panel in progress";

export function panelProgressMessage({
  completedPersonas,
  totalPersonas,
}: PanelProgressCount): string {
  return `${PREFIX} (${completedPersonas}/${totalPersonas} personas)`;
}

/** Reads a progress count back from `panelProgressMessage` text (e.g. an investigation reason). */
export function parsePanelProgress(
  text: string | null | undefined,
): PanelProgressCount | null {
  const match = text?.match(/^Jev panel in progress \((\d+)\/(\d+) personas\)/);
  if (!match) return null;
  return {
    completedPersonas: Number(match[1]),
    totalPersonas: Number(match[2]),
  };
}

/** Body of `202` from POST /api/comparisons: resend the same POST body to resume. */
export const PanelInProgressBodySchema = z.object({
  status: z.literal("in_progress"),
  message: z.string(),
  completedPersonas: z.number().int().nonnegative(),
  totalPersonas: z.number().int().nonnegative(),
});
export type PanelInProgressBody = z.infer<typeof PanelInProgressBodySchema>;

/** First wait before resending an in-progress request; doubles for each resend without progress. */
export const PANEL_RESEND_BASE_MS = 1_000;
/** Consecutive in-progress replies without new personas before a client gives up. */
export const PANEL_MAX_STALLED_RESENDS = 5;

/**
 * Client backoff for resending a deadline-limited panel request: resend after
 * `PANEL_RESEND_BASE_MS` while personas keep completing, doubling the wait for each reply that
 * made no progress, and give up (`null`) after `PANEL_MAX_STALLED_RESENDS` such replies.
 */
export function createPanelResendBackoff() {
  let best = -1;
  let stalled = 0;
  return {
    /** The wait before the next resend, or `null` when the panel has stopped making progress. */
    next(progress: PanelProgressCount): number | null {
      if (progress.completedPersonas > best) {
        best = progress.completedPersonas;
        stalled = 0;
      } else if (++stalled >= PANEL_MAX_STALLED_RESENDS) return null;
      return PANEL_RESEND_BASE_MS * 2 ** stalled;
    },
    reset() {
      best = -1;
      stalled = 0;
    },
  };
}
