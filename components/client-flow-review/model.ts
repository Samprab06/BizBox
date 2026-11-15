import type { WorkspaceCandidate } from "@/components/workspace-screen/client-model";
import type { NessieAccount } from "@/lib/contracts/nessie";

const value = (value: number | null, unit: string) => ({
  value,
  unit,
  origin: "default" as const,
  evidenceIds: ["ui-review"],
  ...(value === null
    ? { unknownReason: "Illustrative property; no verified coordinates" }
    : {}),
});
const flag = {
  value: false,
  unit: "boolean" as const,
  origin: "default" as const,
  evidenceIds: ["ui-review"],
};
function property(
  id: string,
  address: string,
  rent: number,
  area: number,
  propertyId = id,
): WorkspaceCandidate {
  return {
    candidate: {
      id,
      projectId: "client-flow-review",
      synthetic: true,
      name: "Illustrative retail space",
      address,
      city: "Houston",
      latitude: value(null, "degrees"),
      longitude: value(null, "degrees"),
      floorAreaSqFt: value(area, "sq ft"),
      monthlyRentCents: value(rent, "USD cents/month"),
      availableForLease: { ...flag, value: true },
      features: {
        groundFloor: flag,
        parking: flag,
        frontage: flag,
        corner: flag,
      },
    },
    propertyId,
    listingId: id,
    position: null,
    score: 0,
    scoreComponents: {
      rentFit: 0,
      sizeFit: 0,
      position: 0,
      frontage: 0,
      anchorCotenants: 0,
    },
    scoreEvidenceId: "ui-review",
    baseRentCents: value(rent, "USD cents/month"),
    opexCents: value(null, "USD cents/month"),
    totalMonthlyCostCents: value(null, "USD cents/month"),
    flags: ["Illustrative listing facts, not vendor inventory."],
    evidenceIds: ["ui-review"],
    sources: [],
  };
}
export const reviewProperties = [
  property("sample-a", "100 Sample Avenue", 240000, 985),
  property("sample-a2", "100 Sample Avenue", 290000, 1250, "sample-a"),
  property("sample-b", "200 Sample Avenue", 310000, 1600),
  property("sample-c", "300 Sample Avenue", 380000, 2100),
];
export const reviewMetrics = [
  {
    id: "sample-a",
    customers: { mean: 2300, low: 1900, high: 2600 },
    contribution: { mean: 4500, low: 1200, high: 6300 },
  },
  {
    id: "sample-b",
    customers: { mean: 2100, low: 1700, high: 2500 },
    contribution: { mean: 2800, low: -500, high: 4900 },
  },
  {
    id: "sample-c",
    customers: { mean: 2600, low: 2200, high: 3000 },
    contribution: { mean: -1200, low: -3600, high: 1500 },
  },
];
export const accounts: NessieAccount[] = [
  {
    id: "review-operating",
    nickname: "Sample operating account",
    type: "Checking",
    balanceCents: 12000000,
    availableCents: 12000000,
  },
  {
    id: "review-reserve",
    nickname: "Sample reserve",
    type: "Savings",
    balanceCents: 4500000,
    availableCents: 4500000,
  },
];
export type Setup = {
  hours: number;
  staff: number;
  stations: number;
  ticket: number;
};
export const initialSetup: Setup = {
  hours: 10,
  staff: 2,
  stations: 2,
  ticket: 7,
};
export const initialExperiment = () => ({
  draft: { ...initialSetup },
  current: { ...initialSetup },
  run: null as Setup | null,
  kept: false,
  currentChanged: false,
  runBeforeChanged: false,
  runChanged: false,
});
export type Experiment = ReturnType<typeof initialExperiment>;
export const stages = [
  "Property",
  "Compare",
  "Outdoor",
  "Interior",
  "Indoor",
  "Cash",
] as const;
export type Stage = (typeof stages)[number];
