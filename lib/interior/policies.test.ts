import { it, expect, vi } from "vitest";
import { createSpatialDraft, applySpatialCommand } from "@/lib/spatial";
import { prepareInteriorPolicies, type InteriorPolicyStore } from "./policies";
import type { JevAskResult } from "@/lib/panel/jev-client";
function setup(limit = 1_000_000) {
  let reserved = 26_864;
  const cache = new Map<string, JevAskResult>();
  const reservations: number[] = [];
  const store: InteriorPolicyStore = {
    claim: async () => true,
    release: async () => {},
    get: async (_project, key) => cache.get(key) ?? null,
    reserve: async (_grant, _attempt, _project, _key, amount) => {
      if (reserved + amount > limit) return "exhausted";
      reserved += amount;
      reservations.push(amount);
      return "reserved";
    },
    put: async (_project, key, response) => {
      cache.set(key, response);
    },
  };
  const client = {
    modelVersion: "jev-latest",
    ask: vi.fn(async () => ({
      modelVersion: "jev-test-1",
      answers: Object.fromEntries(
        [0, 4, 10].map((n) => [
          `stay_${n}`,
          { probabilities: { yes: 0.8, no: 0.2 }, confidence: 0.6 },
        ]),
      ),
    })),
  };
  const assertScope = vi.fn(async () => {});
  return { client, store, assertScope, reservations };
}
const draft = () =>
  createSpatialDraft({ projectId: "p", siteId: "s", city: "houston" });
it("deduplicates equivalent state requests, reserves before calls and warm-reuses exact cache", async () => {
  const a = draft(),
    deps = setup(),
    input = { projectId: "p", comparisonId: "c", baseline: a, variant: a };
  const result = await prepareInteriorPolicies(input, {
    ...deps,
    grantId: "grant",
  });
  expect(result.policies.baseline.source).toBe("jev");
  expect(result.usage.requests).toBe(3);
  expect(deps.reservations).toHaveLength(3);
  expect(deps.assertScope).toHaveBeenCalledBefore(deps.client.ask);
  const warm = await prepareInteriorPolicies(input, {
    ...deps,
    grantId: "grant",
  });
  expect(warm.usage.requests).toBe(0);
  expect(deps.client.ask).toHaveBeenCalledTimes(3);
});
it("rejects unowned comparisons and exhausted budgets before provider calls", async () => {
  const a = draft(),
    deps = setup();
  deps.assertScope.mockRejectedValueOnce(new Error("not owned"));
  await expect(
    prepareInteriorPolicies(
      { projectId: "p", comparisonId: "c", baseline: a, variant: a },
      { ...deps, grantId: "grant" },
    ),
  ).rejects.toThrow();
  expect(deps.client.ask).not.toHaveBeenCalled();
  const exhausted = setup(26_864);
  await expect(
    prepareInteriorPolicies(
      { projectId: "p", comparisonId: "c", baseline: a, variant: a },
      { ...exhausted, grantId: "grant" },
    ),
  ).rejects.toThrow("budget");
  expect(exhausted.client.ask).not.toHaveBeenCalled();
});
it("does not release failed reservations or silently substitute assumed behavior", async () => {
  const a = draft(),
    deps = setup();
  deps.client.ask.mockRejectedValueOnce(new Error("network"));
  await expect(
    prepareInteriorPolicies(
      { projectId: "p", comparisonId: "c", baseline: a, variant: a },
      { ...deps, grantId: "grant" },
    ),
  ).rejects.toThrow();
  expect(deps.reservations).toHaveLength(1);
  expect(deps.client.ask).toHaveBeenCalledTimes(1);
});
it("rejects mixed model versions and mismatched scopes", async () => {
  const a = draft(),
    deps = setup();
  deps.client.ask.mockResolvedValueOnce({
    modelVersion: "different",
    answers: Object.fromEntries(
      [0, 4, 10].map((n) => [
        `stay_${n}`,
        { probabilities: { yes: 0.8, no: 0.2 }, confidence: 0.6 },
      ]),
    ),
  });
  await expect(
    prepareInteriorPolicies(
      { projectId: "p", comparisonId: "c", baseline: a, variant: a },
      { ...deps, grantId: "grant" },
    ),
  ).rejects.toThrow("version");
  await expect(
    prepareInteriorPolicies(
      {
        projectId: "p",
        comparisonId: "c",
        baseline: a,
        variant: { ...a, siteId: "other" },
      },
      { ...setup(), grantId: "grant" },
    ),
  ).rejects.toThrow("scope");
});
it("changes semantic cache inputs for staff and capacity experiments", async () => {
  const a = draft(),
    b = applySpatialCommand(a, {
      type: "settings",
      settings: { ...a.settings, staff: 1, resourceCapacity: 1 },
    }),
    deps = setup();
  const result = await prepareInteriorPolicies(
    { projectId: "p", comparisonId: "c", baseline: a, variant: b },
    { ...deps, grantId: "grant" },
  );
  expect(result.usage.requests).toBe(6);
  expect(result.policies.baseline.states[0]!.key).not.toBe(
    result.policies.variant.states[0]!.key,
  );
});
it("coalesces concurrent identical preparations into three asks and reservations", async () => {
  const a = draft(),
    deps = setup(),
    input = { projectId: "p", comparisonId: "c", baseline: a, variant: a };
  const [first, second] = await Promise.all([
    prepareInteriorPolicies(input, { ...deps, grantId: "grant" }),
    prepareInteriorPolicies(input, { ...deps, grantId: "grant" }),
  ]);
  expect(first).toEqual(second);
  expect(deps.client.ask).toHaveBeenCalledTimes(3);
  expect(deps.reservations).toHaveLength(3);
});
it("stops remaining calls on cancellation and rejects unpriced aliases", async () => {
  const a = draft(),
    deps = setup(),
    controller = new AbortController();
  deps.client.ask.mockImplementationOnce(async () => {
    controller.abort();
    return {
      modelVersion: "jev-test-1",
      answers: Object.fromEntries(
        [0, 4, 10].map((n) => [
          `stay_${n}`,
          { probabilities: { yes: 0.8, no: 0.2 }, confidence: 0.6 },
        ]),
      ),
    };
  });
  await expect(
    prepareInteriorPolicies(
      { projectId: "p", comparisonId: "c", baseline: a, variant: a },
      { ...deps, grantId: "grant", signal: controller.signal },
    ),
  ).rejects.toThrow("cancelled");
  expect(deps.client.ask).toHaveBeenCalledTimes(1);
  const unknown = setup();
  unknown.client.modelVersion = "unverified-expensive-model";
  await expect(
    prepareInteriorPolicies(
      { projectId: "p", comparisonId: "c", baseline: a, variant: a },
      { ...unknown, grantId: "grant" },
    ),
  ).rejects.toThrow("verified");
  expect(unknown.client.ask).not.toHaveBeenCalled();
});
it("does not spend when another worker owns the pending policy claim", async () => {
  const a = draft(),
    deps = setup();
  deps.store.claim = async () => false;
  await expect(
    prepareInteriorPolicies(
      { projectId: "p", comparisonId: "c", baseline: a, variant: a },
      { ...deps, grantId: "grant" },
    ),
  ).rejects.toThrow("already in progress");
  expect(deps.client.ask).not.toHaveBeenCalled();
  expect(deps.reservations).toHaveLength(0);
});
it("supports explicit coherent cache epoch changes without hidden retries", async () => {
  const a = draft(),
    deps = setup(),
    input = { projectId: "p", comparisonId: "c", baseline: a, variant: a };
  await prepareInteriorPolicies(input, {
    ...deps,
    grantId: "grant",
    cacheEpoch: "one",
  });
  const next = await prepareInteriorPolicies(input, {
    ...deps,
    grantId: "grant",
    cacheEpoch: "two",
  });
  expect(next.usage.requests).toBe(3);
  expect(deps.client.ask).toHaveBeenCalledTimes(6);
});
