import { describe, expect, it, vi } from "vitest";
import {
  EvaluationRequestSchema,
  type SiteTweakMap,
} from "@/lib/contracts/evaluation";
import {
  assembleEvaluation,
  PanelInProgressError,
  SiteTweakError,
  type AssembleEvaluationInput,
} from "@/lib/evaluation/assemble";
import {
  assemblyDependencies,
  assemblyInput,
} from "@/lib/evaluation/__fixtures__/assembly";
import { createMemoryComparisonStore } from "@/lib/evaluation/store";
import {
  createComparisonReadHandler,
  createComparisonsHandler,
} from "./handler";

/** Scene 1: per-site tweaks through POST /api/comparisons, storage, GET and rerun. */

const post = (body: unknown) =>
  new Request("http://test/api/comparisons", {
    method: "POST",
    body: JSON.stringify(body),
  });
const PROJECT = "test-project";
const shortcut = (siteTweaks?: SiteTweakMap) => ({
  projectId: PROJECT,
  profileId: "test-profile",
  candidateIds: ["101:1", "102:2", "103:3"],
  seeds: 1,
  ...(siteTweaks ? { siteTweaks } : {}),
});

function setup(
  assemble = vi.fn((input: AssembleEvaluationInput, deadline?: object) =>
    assembleEvaluation(input, assemblyDependencies(input), deadline),
  ),
) {
  const store = createMemoryComparisonStore({ [PROJECT]: 1 });
  const load = vi.fn(async () => assemblyInput().profile);
  let n = 0;
  const create = createComparisonsHandler({
    store,
    newId: () => `cmp_${++n}`,
    profiles: { load },
    assemble,
  });
  return {
    store,
    load,
    assemble,
    create,
    read: createComparisonReadHandler({ store }),
  };
}

describe("POST /api/comparisons with siteTweaks (Scene 1)", () => {
  it("stores the tweaks with the comparison and reproduces them on GET and rerun", async () => {
    const { store, create, read } = setup();
    const tweaks = {
      "102:2": {
        monthlyRentUsd: 1500,
        staff: 3,
        hours: { openMinute: 480, closeMinute: 1020 },
      },
    };
    const plain = await (await create(post(shortcut()))).json();
    const response = await create(post(shortcut(tweaks)));
    expect(response.status).toBe(201);
    const body = await response.json();
    expect(body.comparisonId).toBe("cmp_2");
    expect(body.assembly.siteTweaks).toEqual(tweaks);
    expect(plain.assembly.siteTweaks).toBeUndefined();
    const metrics = (b: typeof body, id: string) =>
      b.result.sites.find((s: { siteId: string }) => s.siteId === id)
        .monthlyContributionUsd;
    expect(metrics(body, "101:1")).toEqual(metrics(plain, "101:1"));
    expect(metrics(body, "102:2")).not.toEqual(metrics(plain, "102:2"));

    const stored = store.records.get(`${PROJECT}/cmp_2`)!;
    expect(stored.evaluation.assembly?.siteTweaks).toEqual(tweaks);
    const config = stored.evaluation.request.sites.find(
      (s) => s.siteId === "102:2",
    )!.config;
    expect(config.lease.askingRentUsdPerSfYear).toBeCloseTo(
      (1500 * 12) / 1300,
      10,
    );
    expect(config.staff.headcount).toBe(3);
    expect(config.hours.weekend).toEqual({ openMin: 480, closeMin: 1020 });
    // The stored request still parses (JSON round trip, as JSONB stores it).
    expect(
      EvaluationRequestSchema.parse(
        JSON.parse(JSON.stringify(stored.evaluation.request)),
      ),
    ).toEqual(stored.evaluation.request);

    const got = await (
      await read(
        new Request(`http://test/api/comparisons/cmp_2?projectId=${PROJECT}`),
        "cmp_2",
      )
    ).json();
    expect(got.assembly.siteTweaks).toEqual(tweaks);

    const rerun = await create(
      post({ projectId: PROJECT, rerunComparisonId: "cmp_2" }),
    );
    expect(rerun.status).toBe(201);
    const rerunBody = await rerun.json();
    expect(rerunBody.reproduces).toBe(true);
    expect(rerunBody.assembly.siteTweaks).toEqual(tweaks);
    expect(store.records.get(`${PROJECT}/cmp_3`)!.evaluation.request).toEqual(
      stored.evaluation.request,
    );
  }, 120_000);

  it("rejects tweaks for IDs outside candidateIds with a field error, before loading the profile", async () => {
    const { store, load, create } = setup();
    const response = await create(post(shortcut({ "999:9": { staff: 2 } })));
    expect(response.status).toBe(422);
    expect(await response.json()).toEqual({
      code: "INVALID_SITE_TWEAKS",
      message: "Tweaks must name candidates in this comparison.",
      field_errors: {
        "siteTweaks.999:9": [
          "Tweaks name 999:9, which is not one of candidateIds",
        ],
      },
    });
    expect(load).not.toHaveBeenCalled();
    expect(store.records.size).toBe(0);
  });

  it("returns 422 with field errors for impossible hours and unknown tweak fields", async () => {
    const { store, load, create } = setup();
    const hours = await create(
      post(
        shortcut({ "101:1": { hours: { openMinute: 900, closeMinute: 600 } } }),
      ),
    );
    expect(hours.status).toBe(422);
    expect((await hours.json()).field_errors).toEqual({
      "siteTweaks.101:1.hours.closeMinute": [
        "Close must follow open within the modeled day",
      ],
    });
    const late = await create(
      post(
        shortcut({ "101:1": { hours: { openMinute: 60, closeMinute: 1441 } } }),
      ),
    );
    expect(late.status).toBe(422);
    expect(Object.keys((await late.json()).field_errors)).toEqual([
      "siteTweaks.101:1.hours.closeMinute",
    ]);
    const unknownField = await create(
      post({
        ...shortcut(),
        siteTweaks: { "101:1": { rentPerSf: 30 } },
      }),
    );
    expect(unknownField.status).toBe(422);
    expect(load).not.toHaveBeenCalled();
    expect(store.records.size).toBe(0);
  });

  it("maps a SiteTweakError from assembly to a 422 with its field errors", async () => {
    const { store, create } = setup(
      vi.fn(async () => {
        throw new SiteTweakError("Tweaks for 101:1 make the site impossible", {
          "siteTweaks.101:1.hours": ["closeMin must be after openMin"],
        });
      }),
    );
    const response = await create(
      post(
        shortcut({ "101:1": { hours: { openMinute: 60, closeMinute: 120 } } }),
      ),
    );
    expect(response.status).toBe(422);
    expect(await response.json()).toEqual({
      code: "INVALID_SITE_TWEAKS",
      message: "Tweaks for 101:1 make the site impossible",
      field_errors: {
        "siteTweaks.101:1.hours": ["closeMin must be after openMin"],
      },
    });
    expect(store.records.size).toBe(0);
  });

  it("resumes a 202 Jev panel when the identical tweaked body is resent (HAC-155)", async () => {
    const tweaks = { "101:1": { staff: 4, monthlyRentUsd: 2000 } };
    const real = (input: AssembleEvaluationInput) =>
      assembleEvaluation(input, assemblyDependencies(input));
    const assemble = vi
      .fn()
      .mockImplementationOnce(async () => {
        throw new PanelInProgressError(3, 9);
      })
      .mockImplementationOnce(real);
    const { store, create } = setup(assemble);
    const body = { ...shortcut(tweaks), demandSource: "jev" };
    const first = await create(post(body));
    expect(first.status).toBe(202);
    expect((await first.json()).status).toBe("in_progress");
    expect(store.records.size).toBe(0);
    const second = await create(post(body));
    expect(second.status).toBe(201);
    expect(assemble.mock.calls[0]![0]).toEqual(assemble.mock.calls[1]![0]);
    expect(assemble.mock.calls[1]![0].siteTweaks).toEqual(tweaks);
    expect((await second.json()).assembly.siteTweaks).toEqual(tweaks);
  }, 120_000);
});
