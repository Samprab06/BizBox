import { createHash, randomUUID } from "node:crypto";
import { z } from "zod";
import {
  SpatialDraftSchema,
  SpatialPoliciesSchema,
  type SpatialDraft,
  type SpatialPolicy,
  type SpatialPolicyState,
} from "@/lib/contracts/spatial";
import { getSpatialPolicyStates, spatialReadiness } from "@/lib/spatial";
import {
  toWireRequest,
  type JevAskRequest,
  type JevAskResult,
  type JevClient,
} from "@/lib/panel/jev-client";
export const INTERIOR_JEV_REQUEST_MODEL = "jev-latest";
export const INTERIOR_POLICY_VERSION = "interior-queue-policy-v1";
export const INTERIOR_JEV_LIMIT_MICROUSD = 1_000_000;
export const INTERIOR_JEV_HISTORICAL_MICROUSD = 26_864;
export const InteriorPoliciesRequestSchema = z
  .object({
    comparisonId: z.string().trim().min(1).max(200),
    baseline: SpatialDraftSchema,
    variant: SpatialDraftSchema,
  })
  .strict();
export const InteriorJevResponseSchema = z
  .object({
    modelVersion: z.string().min(1).max(200),
    answers: z.record(
      z.string(),
      z
        .object({
          probabilities: z.record(
            z.string(),
            z.number().finite().min(0).max(1),
          ),
          confidence: z.number().finite().min(0).max(1),
        })
        .strict(),
    ),
  })
  .strict();
export interface InteriorPolicyStore {
  assertReady?(grantId: string): Promise<void>;
  claim(projectId: string, key: string, owner: string): Promise<boolean>;
  release(projectId: string, key: string, owner: string): Promise<void>;
  get(projectId: string, key: string): Promise<JevAskResult | null>;
  reserve(
    grantId: string,
    attemptId: string,
    projectId: string,
    key: string,
    microusd: number,
  ): Promise<"reserved" | "exhausted" | "unavailable">;
  put(projectId: string, key: string, result: JevAskResult): Promise<void>;
}
export class InteriorPolicyError extends Error {
  constructor(
    public code:
      | "scope"
      | "unsupported"
      | "unavailable"
      | "budget_exhausted"
      | "invalid_provider",
    message: string,
  ) {
    super(message);
  }
}
export type InteriorPolicyInput = {
  projectId: string;
  comparisonId: string;
  baseline: SpatialDraft;
  variant: SpatialDraft;
};
export function interiorPolicyRequest(
  state: SpatialPolicyState,
): JevAskRequest {
  const observations = {
    routeMeters: state.routeLengthM,
    availableSeats: state.seats,
    priceUsd: state.averageTicketUsd,
    meanServiceMinutes: state.serviceMin,
    staff: state.staff,
    serviceCapacity: state.serviceCapacity,
  };
  return {
    state: {
      person: state.description,
      need: "Decide whether to join and remain for coffee service, based only on the offered conditions.",
      options: { cafe: JSON.stringify(observations) },
    },
    questions: [0, 4, 10].map((n) => ({
      name: `stay_${n}`,
      type: "noul" as const,
      prompt: `Would this person join and remain for coffee service with ${n} people waiting and an estimated ${(n * state.queueWaitMinPerPerson).toFixed(2)} minute wait? Consider the observed route, seating, price and service capacity. Return the probability yes.`,
    })),
  };
}
export function interiorPolicyCacheKey(
  projectId: string,
  model: string,
  request: JevAskRequest,
  epoch = INTERIOR_POLICY_VERSION,
) {
  return createHash("sha256")
    .update(
      JSON.stringify({
        version: INTERIOR_POLICY_VERSION,
        epoch,
        projectId,
        request: toWireRequest(model, request),
      }),
    )
    .digest("hex");
}
/** Same conservative envelope as the approved initial check: <=4096 bytes, four copies, $1/M input ceiling. */
export function interiorPolicyReservationMicrousd(
  model: string,
  request: JevAskRequest,
) {
  if (model !== INTERIOR_JEV_REQUEST_MODEL)
    throw new InteriorPolicyError(
      "unsupported",
      "Interior Jev model has no verified reservation price",
    );
  const bytes = Buffer.byteLength(
    JSON.stringify(toWireRequest(model, request)),
    "utf8",
  );
  if (bytes > 4096 || request.questions.length !== 3)
    throw new InteriorPolicyError(
      "unsupported",
      "Interior Jev request envelope exceeds the approved bound",
    );
  return bytes * 4;
}
export type InteriorPolicyPorts = {
  grantId: string;
  client: JevClient;
  store: InteriorPolicyStore;
  assertScope: (
    projectId: string,
    comparisonId: string,
    draft: SpatialDraft,
  ) => Promise<void>;
  now?: () => number;
  deadlineAt?: number;
  cacheEpoch?: string;
  signal?: AbortSignal;
};
export type InteriorPolicyPreparation = {
  policies: z.infer<typeof SpatialPoliciesSchema>;
  usage: { requests: number; reservedMicrousd: number; cacheHits: number };
};
const inflight = new WeakMap<
  InteriorPolicyStore,
  Map<string, Promise<InteriorPolicyPreparation>>
>();
function checkAbort(signal?: AbortSignal) {
  if (signal?.aborted)
    throw new InteriorPolicyError(
      "unavailable",
      "Interior Jev request cancelled; no further provider calls started",
    );
}
export function prepareInteriorPolicies(
  input: InteriorPolicyInput,
  ports: InteriorPolicyPorts,
): Promise<InteriorPolicyPreparation> {
  try {
    checkAbort(ports.signal);
  } catch (error) {
    return Promise.reject(error);
  }
  let pending = inflight.get(ports.store);
  if (!pending) {
    pending = new Map();
    inflight.set(ports.store, pending);
  }
  const key = createHash("sha256")
    .update(
      JSON.stringify({
        input,
        grant: ports.grantId,
        model: ports.client.modelVersion,
        epoch: ports.cacheEpoch ?? INTERIOR_POLICY_VERSION,
      }),
    )
    .digest("hex");
  const found = pending.get(key);
  if (found) return found;
  const work = prepareWork(input, ports);
  pending.set(key, work);
  void work.then(
    () => pending!.delete(key),
    () => pending!.delete(key),
  );
  return work;
}
async function prepareWork(
  input: InteriorPolicyInput,
  ports: InteriorPolicyPorts,
): Promise<InteriorPolicyPreparation> {
  if (ports.client.modelVersion !== INTERIOR_JEV_REQUEST_MODEL)
    throw new InteriorPolicyError(
      "unsupported",
      "Interior Jev model is not the verified requested alias",
    );
  const baseline = SpatialDraftSchema.parse(input.baseline),
    variant = SpatialDraftSchema.parse(input.variant);
  if (
    baseline.projectId !== input.projectId ||
    variant.projectId !== input.projectId ||
    baseline.siteId !== variant.siteId ||
    baseline.id !== variant.id ||
    baseline.city !== variant.city ||
    baseline.category !== variant.category
  )
    throw new InteriorPolicyError("scope", "Interior policy scope mismatch");
  if (baseline.category !== "coffee")
    throw new InteriorPolicyError(
      "unsupported",
      "Live interior Jev policies currently support cafe experiments only",
    );
  for (const draft of [baseline, variant]) {
    checkAbort(ports.signal);
    if (!spatialReadiness(draft).runnable)
      throw new InteriorPolicyError(
        "unsupported",
        "Interior geometry or city is not runnable",
      );
    await ports.assertScope(input.projectId, input.comparisonId, draft);
  }
  if (!ports.grantId)
    throw new InteriorPolicyError(
      "unavailable",
      "Durable Jev budget grant unavailable",
    );
  checkAbort(ports.signal);
  await ports.store.assertReady?.(ports.grantId);
  const usage = { requests: 0, reservedMicrousd: 0, cacheHits: 0 };
  let returnedModel: string | undefined;
  const now = ports.now ?? Date.now;
  function validateResponse(raw: unknown) {
    const result = InteriorJevResponseSchema.parse(raw);
    for (const n of [0, 4, 10]) {
      const a = result.answers[`stay_${n}`];
      if (
        a?.probabilities.yes === undefined ||
        a?.probabilities.no === undefined ||
        Math.abs(a.probabilities.yes + a.probabilities.no - 1) > 1e-6
      )
        throw new InteriorPolicyError(
          "invalid_provider",
          "Interior Jev returned incomplete probabilities",
        );
    }
    if (returnedModel !== undefined && result.modelVersion !== returnedModel)
      throw new InteriorPolicyError(
        "invalid_provider",
        "Interior Jev model version changed across policies; rotate the server cache epoch for an explicit coherent retry. No automatic retry was made",
      );
    return result;
  }
  async function policy(draft: SpatialDraft): Promise<SpatialPolicy> {
    const states = [];
    for (const state of getSpatialPolicyStates(draft)) {
      checkAbort(ports.signal);
      const request = interiorPolicyRequest(state),
        key = interiorPolicyCacheKey(
          input.projectId,
          ports.client.modelVersion,
          request,
          ports.cacheEpoch ?? INTERIOR_POLICY_VERSION,
        );
      let result = await ports.store.get(input.projectId, key);
      if (result) usage.cacheHits++;
      else {
        const owner = randomUUID();
        checkAbort(ports.signal);
        if (!(await ports.store.claim(input.projectId, key, owner)))
          throw new InteriorPolicyError(
            "unavailable",
            "Interior Jev policy preparation is already in progress; no duplicate call started",
          );
        try {
          result = await ports.store.get(input.projectId, key);
          if (result) usage.cacheHits++;
          else {
            checkAbort(ports.signal);
            if (
              ports.deadlineAt !== undefined &&
              now() + 7000 >= ports.deadlineAt
            )
              throw new InteriorPolicyError(
                "unavailable",
                "Interior Jev preparation deadline reached; completed responses remain cached",
              );
            const reserved = interiorPolicyReservationMicrousd(
              ports.client.modelVersion,
              request,
            );
            const status = await ports.store.reserve(
              ports.grantId,
              randomUUID(),
              input.projectId,
              key,
              reserved,
            );
            if (status === "exhausted")
              throw new InteriorPolicyError(
                "budget_exhausted",
                "Interior Jev budget exhausted",
              );
            if (status !== "reserved")
              throw new InteriorPolicyError(
                "unavailable",
                "Durable interior Jev budget grant unavailable",
              );
            usage.reservedMicrousd += reserved;
            checkAbort(ports.signal);
            usage.requests++;
            try {
              result = validateResponse(await ports.client.ask(request));
            } catch (error) {
              if (error instanceof InteriorPolicyError) throw error;
              throw new InteriorPolicyError(
                "invalid_provider",
                "Interior Jev request failed; reservation retained and no assumed behavior substituted",
              );
            }
            await ports.store.put(input.projectId, key, result);
          }
        } finally {
          await ports.store.release(input.projectId, key, owner);
        }
      }
      result = validateResponse(result);
      returnedModel = result.modelVersion;
      states.push({
        ...state,
        stayByQueue: [0, 4, 10].map((n) => ({
          lineLength: n,
          p: result!.answers[`stay_${n}`]!.probabilities.yes!,
        })),
      });
    }
    return {
      source: "jev",
      modelVersion: returnedModel!,
      evidenceId: `jev-policy-${createHash("sha256")
        .update(JSON.stringify({ model: returnedModel, states }))
        .digest("hex")}`,
      states,
    };
  }
  const a = await policy(baseline),
    b = await policy(variant);
  checkAbort(ports.signal);
  return {
    policies: SpatialPoliciesSchema.parse({ baseline: a, variant: b }),
    usage,
  };
}
