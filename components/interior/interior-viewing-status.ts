import type { InteriorDiscovery } from "@/lib/contracts/interior";
/** Registry approval, checked public status and SDK rendering are distinct evidence. */
export function interiorViewingStatus(
  model: InteriorDiscovery["models"][number],
) {
  return {
    registry: model.displayApproved
      ? "Registry display approved"
      : "Not registry approved",
    public:
      model.publicStatus === "public"
        ? "Checked public"
        : model.publicStatus === "private"
          ? "Checked non-public"
          : "Public status not verified in this response",
    viewing:
      model.viewingEligible === true
        ? "Eligible for verified public viewing"
        : model.viewingEligible === false
          ? "Not eligible for public viewing"
          : "Fresh viewing eligibility not reported",
  };
}
