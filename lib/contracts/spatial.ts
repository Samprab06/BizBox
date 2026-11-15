import { z } from "zod";
import type { DailyMetrics, SimEvent } from "@/lib/sim/contracts";
const id = z.string().trim().min(1).max(200);
const positive = z.number().finite().positive();
const point = z
  .object({ x: z.number().finite(), z: z.number().finite() })
  .strict();

const worldPoint = z.object({ x: z.number().finite(), y: z.number().finite(), z: z.number().finite() }).strict();
export const SpatialScanContextSchema = z.object({
  modelId: z.string().regex(/^[A-Za-z0-9]{11}$/),
  floorPoint: worldPoint.optional(),
  floorPointSource: z.enum(["pointer", "sweep"]).optional(),
  camera: z.object({ position: worldPoint, rotation: z.object({ x: z.number().finite(), y: z.number().finite() }).strict(), sweepId: id.optional() }).strict().optional(),
  placementAvailable: z.boolean(),
}).strict();
export type SpatialScanContext = z.infer<typeof SpatialScanContextSchema>;
const scanAlignment = z.object({
  source: z.literal("scan-floor-placement"), projectId: id, siteId: id, draftId: id,
  modelId: z.string().regex(/^[A-Za-z0-9]{11}$/), widthM: positive, depthM: positive,
  origin: worldPoint, rotationY: z.number().finite(), roomAnchor: point,
}).strict();
export const SpatialSettingsSchema = z
  .object({
    openMin: z.number().int().min(0).max(1439),
    closeMin: z.number().int().min(1).max(1440),
    arrivals: z.number().int().min(0).max(500),
    serviceMin: positive.max(240),
    staff: z.number().int().min(1).max(20),
    averageTicketUsd: z.number().finite().min(0).max(10000),
    wageUsdPerHour: z.number().finite().min(0).max(1000),
    cogsFraction: z.number().min(0).max(1),
    resourceCapacity: z.number().int().min(1).max(40).optional(),
    appointmentFraction: z.number().min(0).max(1).optional(),
    sessionIntervalMin: positive.max(240).optional(),
    pickupMin: z.number().finite().min(0).max(60).optional(),
  })
  .strict()
  .refine((s) => s.closeMin > s.openMin, "Closing must follow opening");
export const SpatialDraftSchema = z
  .object({
    version: z.literal(1),
    id,
    revision: z.number().int().nonnegative(),
    projectId: id,
    siteId: id,
    city: z.enum(["houston", "los_angeles"]),
    timezone: z.enum(["America/Chicago", "America/Los_Angeles"]),
    category: z.enum(["coffee", "quick_food", "salon_barber", "fitness"]),
    room: z
      .object({
        widthM: positive.min(4).max(30),
        depthM: positive.min(4).max(30),
        source: z.enum(["assumed", "matterport-bounds"]),
        alignment: scanAlignment.optional(),
        scan: z
          .object({
            modelId: z.string().regex(/^[A-Za-z0-9]{11}$/),
            floorId: id,
            roomId: id,
            min: z
              .object({
                x: z.number().finite(),
                y: z.number().finite(),
                z: z.number().finite(),
              })
              .strict(),
            max: z
              .object({
                x: z.number().finite(),
                y: z.number().finite(),
                z: z.number().finite(),
              })
              .strict(),
          })
          .strict()
          .optional(),
      })
      .strict()
      .refine(
        (room) =>
          room.source === "matterport-bounds" ? Boolean(room.scan) : !room.scan,
        "Measured room envelopes require their exact scan binding",
      ),
    entrance: point,
    servicePoint: point,
    items: z
      .array(
        z
          .object({
            id,
            catalogId: id,
            x: z.number().finite(),
            z: z.number().finite(),
            rotation: z.union([
              z.literal(0),
              z.literal(90),
              z.literal(180),
              z.literal(270),
            ]),
          })
          .strict(),
      )
      .max(60),
    settings: SpatialSettingsSchema,
    limitations: z.array(z.string()).max(30),
  })
  .strict()
  .refine((draft) => {
    const a = draft.room.alignment;
    return !a || (draft.room.source === "assumed" && a.projectId === draft.projectId && a.siteId === draft.siteId && a.draftId === draft.id && a.widthM === draft.room.widthM && a.depthM === draft.room.depthM);
  }, "Scan placement must match this exact assumed proposal");
export type SpatialDraft = z.infer<typeof SpatialDraftSchema>;
export const SpatialCommandSchema = z.discriminatedUnion("type", [
  z
    .object({ type: z.literal("layout"), entrance: point, servicePoint: point })
    .strict(),
  z
    .object({
      type: z.literal("add"),
      catalogId: id,
      id,
      x: z.number().finite(),
      z: z.number().finite(),
      rotation: z.union([
        z.literal(0),
        z.literal(90),
        z.literal(180),
        z.literal(270),
      ]),
    })
    .strict(),
  z.object({ type: z.literal("remove"), id }).strict(),
  z
    .object({
      type: z.literal("move"),
      id,
      x: z.number().finite(),
      z: z.number().finite(),
    })
    .strict(),
  z
    .object({
      type: z.literal("rotate"),
      id,
      rotation: z.union([
        z.literal(0),
        z.literal(90),
        z.literal(180),
        z.literal(270),
      ]),
    })
    .strict(),
  z.object({ type: z.literal("clear") }).strict(),
  z
    .object({ type: z.literal("settings"), settings: SpatialSettingsSchema })
    .strict(),
]);
export type SpatialCommand = z.infer<typeof SpatialCommandSchema>;
export const SpatialPolicyStateSchema = z
  .object({
    key: id,
    contextHash: id,
    personaId: id,
    routeLengthM: z.number().finite().nonnegative(),
    seats: z.number().int().nonnegative(),
    category: z.enum(["coffee", "quick_food", "salon_barber", "fitness"]),
    serviceMin: positive,
    staff: z.number().int().min(1).max(20),
    serviceCapacity: z.number().int().min(1).max(160),
    queueWaitMinPerPerson: positive,
    averageTicketUsd: z.number().finite().nonnegative(),
    description: z.string().max(500),
  })
  .strict();
export type SpatialPolicyState = z.infer<typeof SpatialPolicyStateSchema>;
export const SpatialPolicySchema = z
  .object({
    source: z.literal("jev"),
    modelVersion: id,
    evidenceId: id,
    states: z
      .array(
        SpatialPolicyStateSchema.extend({
          stayByQueue: z
            .array(
              z
                .object({
                  lineLength: z.number().int().nonnegative(),
                  p: z.number().finite().min(0).max(1),
                })
                .strict(),
            )
            .min(1)
            .max(20),
        }).strict(),
      )
      .min(1)
      .max(20),
  })
  .strict();
export type SpatialPolicy = z.infer<typeof SpatialPolicySchema>;
export const SpatialPoliciesSchema = z
  .object({ baseline: SpatialPolicySchema, variant: SpatialPolicySchema })
  .strict();
export type SpatialPolicies = z.infer<typeof SpatialPoliciesSchema>;
export const SpatialPolicyReceiptSchema = z
  .object({
    version: z.literal(1),
    digest: z.string().regex(/^[a-f0-9]{64}$/),
    signature: z.string().regex(/^[a-f0-9]{64}$/),
  })
  .strict();
export type SpatialPolicyReceipt = z.infer<typeof SpatialPolicyReceiptSchema>;
export type SpatialDecision = {
  customerId: string;
  personaId: string;
  timeMin: number;
  action: "join" | "leave";
  probability: number;
  draw: number;
  queueLength: number;
  policyKey: string;
  source: "assumed" | "jev";
  modelVersion: string | null;
  evidenceId: string | null;
  routeLengthM: number;
  seats: number;
};
export type SpatialCustomer = {
  id: string;
  personaId: string;
  arrivalMin: number;
  walkStartMin: number;
  queueArrivalMin: number;
  route: { x: number; z: number }[];
  serviceMin: number;
  appointment: boolean;
};
export type SpatialRun = {
  seed: number;
  events: SimEvent[];
  metrics: DailyMetrics;
  decisions: SpatialDecision[];
  customers: SpatialCustomer[];
  walkingAtClose: number;
  routeLengthM: number;
  dailyContributionUsd: number;
  adapter:
    | "counter-service"
    | "order-preparation-pickup"
    | "appointment-chair"
    | "session-occupancy";
  capacity: number;
  stageEvents: {
    customerId: string;
    stage: "preparation" | "pickup" | "session" | "appointment";
    startMin: number;
    endMin: number;
  }[];
};
export type SpatialEstimate = { mean: number; p5: number; p95: number };
export type SpatialNullableEstimate = {
  mean: number | null;
  p5: number | null;
  p95: number | null;
};
export type SpatialExperimentSide = {
  draft: SpatialDraft;
  policyStates: SpatialPolicyState[];
  runs: SpatialRun[];
  metrics: Record<
    | "served"
    | "abandoned"
    | "revenueUsd"
    | "dailyContributionUsd"
    | "routeLengthM",
    SpatialEstimate
  > & { meanWaitMin: SpatialNullableEstimate };
};
export type SpatialExperimentResult = {
  version: 1;
  projectId: string;
  siteId: string;
  baselineRevision: number;
  variantRevision: number;
  seeds: number[];
  source: "assumed" | "jev" | "mixed";
  policySnapshots: {
    baseline: SpatialPolicy | null;
    variant: SpatialPolicy | null;
  };
  baseline: SpatialExperimentSide;
  variant: SpatialExperimentSide;
  delta: SpatialExperimentSide["metrics"];
  findings: string[];
  limitations: string[];
};
const nonnegative = z.number().finite().nonnegative();
const SimEventSchema = z.discriminatedUnion("type", [
  z
    .object({
      type: z.literal("arrival"),
      timeMin: nonnegative,
      customerId: id,
      personaId: id,
      lineLength: nonnegative,
      stayProbability: z.number().min(0).max(1),
      decision: z.enum(["join", "leave"]),
    })
    .strict(),
  z
    .object({
      type: z.literal("queue_entry"),
      timeMin: nonnegative,
      customerId: id,
      patienceMin: nonnegative,
    })
    .strict(),
  z
    .object({
      type: z.literal("service_start"),
      timeMin: nonnegative,
      customerId: id,
      stationIndex: nonnegative,
      waitMin: nonnegative,
    })
    .strict(),
  z
    .object({
      type: z.literal("completion"),
      timeMin: nonnegative,
      customerId: id,
      stationIndex: nonnegative,
      revenueUsd: nonnegative,
    })
    .strict(),
  z
    .object({
      type: z.literal("abandonment"),
      timeMin: nonnegative,
      customerId: id,
      waitMin: nonnegative,
    })
    .strict(),
]);
const metrics = z
  .object({
    dayType: z.enum(["weekday", "weekend"]),
    openMin: nonnegative,
    closeMin: nonnegative,
    stations: nonnegative,
    arrivals: nonnegative,
    arrivalsOutsideHours: nonnegative,
    joined: nonnegative,
    served: nonnegative,
    balked: nonnegative,
    reneged: nonnegative,
    abandoned: nonnegative,
    inServiceAtClose: nonnegative,
    waitingAtClose: nonnegative,
    meanWaitMin: nonnegative.nullable(),
    p90WaitMin: nonnegative.nullable(),
    stationUtilization: z.number().min(0).max(1),
    revenueUsd: nonnegative,
  })
  .strict();
const decision = z
  .object({
    customerId: id,
    personaId: id,
    timeMin: nonnegative,
    action: z.enum(["join", "leave"]),
    probability: z.number().min(0).max(1),
    draw: z.number().min(0).lt(1),
    queueLength: nonnegative,
    policyKey: id,
    source: z.enum(["assumed", "jev"]),
    modelVersion: id.nullable(),
    evidenceId: id.nullable(),
    routeLengthM: nonnegative,
    seats: nonnegative,
  })
  .strict();
const run = z
  .object({
    seed: z.number().int(),
    events: z.array(SimEventSchema).max(5000),
    metrics,
    decisions: z.array(decision).max(500),
    customers: z
      .array(
        z
          .object({
            id,
            personaId: id,
            arrivalMin: nonnegative,
            walkStartMin: nonnegative,
            queueArrivalMin: nonnegative,
            route: z.array(point).max(4000),
            serviceMin: positive,
            appointment: z.boolean(),
          })
          .strict(),
      )
      .max(500),
    walkingAtClose: nonnegative,
    routeLengthM: nonnegative,
    dailyContributionUsd: z.number().finite(),
    adapter: z.enum([
      "counter-service",
      "order-preparation-pickup",
      "appointment-chair",
      "session-occupancy",
    ]),
    capacity: positive,
    stageEvents: z
      .array(
        z
          .object({
            customerId: id,
            stage: z.enum(["preparation", "pickup", "session", "appointment"]),
            startMin: nonnegative,
            endMin: nonnegative,
          })
          .strict(),
      )
      .max(1000),
  })
  .strict();
const estimate = z
  .object({
    mean: z.number().finite(),
    p5: z.number().finite(),
    p95: z.number().finite(),
  })
  .strict();
const estimates = z
  .object({
    served: estimate,
    abandoned: estimate,
    revenueUsd: estimate,
    dailyContributionUsd: estimate,
    meanWaitMin: z
      .object({
        mean: z.number().finite().nullable(),
        p5: z.number().finite().nullable(),
        p95: z.number().finite().nullable(),
      })
      .strict(),
    routeLengthM: estimate,
  })
  .strict();
const side = z
  .object({
    draft: SpatialDraftSchema,
    policyStates: z.array(SpatialPolicyStateSchema).max(20),
    runs: z.array(run).min(1).max(10),
    metrics: estimates,
  })
  .strict();
/** Shape validation only. Reports must recompute from scoped drafts/policies rather than trust browser metrics. */
export const SpatialExperimentResultSchema = z
  .object({
    version: z.literal(1),
    projectId: id,
    siteId: id,
    baselineRevision: nonnegative,
    variantRevision: nonnegative,
    seeds: z.array(z.number().int()).min(1).max(10),
    source: z.enum(["assumed", "jev", "mixed"]),
    policySnapshots: z
      .object({
        baseline: SpatialPolicySchema.nullable(),
        variant: SpatialPolicySchema.nullable(),
      })
      .strict(),
    baseline: side,
    variant: side,
    delta: estimates,
    findings: z.array(z.string()).max(30),
    limitations: z.array(z.string()).max(60),
  })
  .strict();

const FindingRangeSchema = z.object({mean:z.number().finite().nullable(),p5:z.number().finite().nullable(),p95:z.number().finite().nullable()}).strict();
const FindingMetricsSchema = z.object({routeLengthM:FindingRangeSchema,walkingDelayMin:FindingRangeSchema,served:FindingRangeSchema,meanWaitMin:FindingRangeSchema,left:FindingRangeSchema,revenueUsd:FindingRangeSchema,dailyContributionUsd:FindingRangeSchema}).strict();
export const ControlledInteriorFindingSchema = z.object({
 question:z.string().min(1).max(1000),
 change:z.object({type:z.literal("add"),item:SpatialDraftSchema.shape.items.element,name:z.string().min(1)}).strict(),
 source:z.enum(["assumed","jev","mixed"]),seeds:z.array(z.number().int()).min(1).max(10),
 heldFixed:z.array(z.string()).max(20),before:FindingMetricsSchema,after:FindingMetricsSchema,metrics:FindingMetricsSchema,
 findings:z.array(z.string()).max(30),limitations:z.array(z.string()).max(60),
}).strict();
export type ControlledInteriorFinding = z.infer<typeof ControlledInteriorFindingSchema>;
