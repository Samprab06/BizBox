export type NativeProposalStatus = {
  revision: number;
  status: "loading" | "ready" | "failed";
};
/** Give a queued experiment an actionable state while native loading and inference finish. */
export function nativeWorkStatus(input: {
  awaitingPlacement?: boolean;
  preparing?: boolean;
  revision: number;
  native?: NativeProposalStatus | null;
}): string | null {
  if (input.awaitingPlacement)
    return "Click the floor in Matterport to place it here.";
  if (!input.preparing) return null;
  if (input.native?.revision === input.revision) {
    if (input.native.status === "ready") return "Running the comparison…";
    if (input.native.status === "failed")
      return "The furniture could not be displayed. Ask the assistant to try another spot.";
  }
  return "Placing furniture in Matterport…";
}
