import { expect, it } from "vitest";
import { interiorViewingStatus } from "./interior-viewing-status";
const model = {
  modelId: "Synthetic01",
  scope: "property" as const,
  sourceField: "property.virtualTour",
  displayApproved: false,
  reason: "Public source verified",
};
it("publicly verified auto-viewing does not become registry approval", () => {
  expect(
    interiorViewingStatus({
      ...model,
      publicStatus: "public",
      viewingEligible: true,
    }),
  ).toEqual({
    registry: "Not registry approved",
    public: "Checked public",
    viewing: "Eligible for verified public viewing",
  });
});
it("an older registry mapping does not invent a fresh public verification", () => {
  expect(
    interiorViewingStatus({ ...model, displayApproved: true }),
  ).toMatchObject({
    registry: "Registry display approved",
    public: "Public status not verified in this response",
    viewing: "Fresh viewing eligibility not reported",
  });
});
