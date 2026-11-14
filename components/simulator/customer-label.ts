/** Stored canonical events keep the decision, not the original probability. */
export function customerLabel(
  customer: {
    lineLength: number;
    stayProbability: number;
    decision: "join" | "leave";
  },
  stored: boolean,
) {
  return stored
    ? `${customer.lineLength} in line · recorded ${customer.decision === "join" ? "joined" : "left"} · join probability not stored`
    : `${customer.lineLength} in line · ${Math.round(customer.stayProbability * 100)}% modeled join probability · ${customer.decision === "join" ? "joined" : "left"}`;
}
