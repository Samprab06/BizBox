import { createHash } from "node:crypto";
import { z } from "zod";
import { BusinessProfileSchema, type BusinessProfile } from "@/lib/contracts";
import {
  IntakeDraftSchema,
  IntakePatchSchema,
  type IntakeState,
} from "@/lib/contracts/intake";
import {
  EvaluationOverridesSchema,
  SensitivityRequestSchema,
} from "@/lib/contracts/evaluation";
import type { SiteSearchResult } from "@/lib/contracts/sites";
import type { CatchmentResponse } from "@/lib/contracts/catchment";
import type { InvestigationJob, InvestigationMilestone } from "./jobs";
import {
  AssemblyError,
  type AssembledEvaluation,
} from "@/lib/evaluation/assemble";
import {
  buildStoredComparison,
  type ComparisonStore,
  type StoredComparison,
  withSensitivity,
} from "@/lib/evaluation/store";
import {
  demandSourceCheck,
  evaluateSites,
  runSensitivity,
  siteRunSummary,
} from "@/lib/evaluation/evaluate";
import { createIntakeSession } from "./intake";

const id = z.string().min(1).max(512);
const siteIds = z
  .array(
    z
      .string()
      .max(100)
      .regex(/^\d+:\d+$/),
  )
  .min(1)
  .max(8)
  .refine((ids) => new Set(ids).size === ids.length, "Site IDs must be unique");
const filters = z
  .object({
    minSizeSqFt: z.number().positive().optional(),
    maxSizeSqFt: z.number().positive().optional(),
    limit: z.number().int().min(1).max(8).optional(),
  })
  .strict();
export const InvestigationToolSchemas = {
  save_profile: z.object({ patch: IntakePatchSchema }).strict(),
  search_sites: z.object({ filters: filters.default({}) }).strict(),
  get_catchment: z.object({ site_id: siteIds.element }).strict(),
  poll_customers: z
    .object({
      site_ids: siteIds,
      competitor_ids: z.array(id).max(100).optional(),
      price: z.number().positive().max(10000).optional(),
    })
    .strict(),
  evaluate_sites: z
    .object({
      site_ids: siteIds,
      overrides: EvaluationOverridesSchema.optional(),
      demand_source: z.enum(["huff", "jev"]).optional(),
      seeds: z.number().int().min(1).max(30).optional(),
    })
    .strict(),
  run_sensitivity: SensitivityRequestSchema.extend({
    comparison_id: id,
  }).strict(),
  get_site_run: z.object({ run_id: id }).strict(),
};
export type InvestigationToolName = keyof typeof InvestigationToolSchemas;
export type InvestigationToolContext = {
  job: InvestigationJob;
  milestones: InvestigationMilestone[];
  signal: AbortSignal;
  idempotencyKey: string;
};
export type InvestigationToolResult = {
  summary: z.infer<ReturnType<typeof z.json>>;
  findings?: string[];
  done?: boolean;
};
export interface InvestigationToolRegistry {
  definitions: {
    name: InvestigationToolName;
    description: string;
    schema: z.ZodType;
  }[];
  execute(
    name: InvestigationToolName,
    args: unknown,
    context: InvestigationToolContext,
  ): Promise<InvestigationToolResult>;
}
export type PollContext = { competitor_ids?: string[]; price?: number };
export type InvestigationToolDependencies = {
  loadProfile(
    projectId: string,
    profileId: string,
  ): Promise<BusinessProfile | null>;
  saveProfile(
    projectId: string,
    profile: BusinessProfile,
    key: string,
    signal: AbortSignal,
  ): Promise<BusinessProfile | null>;
  search(
    profile: BusinessProfile,
    input: z.infer<typeof filters>,
    signal: AbortSignal,
  ): Promise<SiteSearchResult>;
  catchment(
    profile: BusinessProfile,
    siteId: string,
    signal: AbortSignal,
  ): Promise<CatchmentResponse>;
  assemble(
    profile: BusinessProfile,
    siteIds: string[],
    options: PollContext & { mode: "paid" | "cache-only" | "huff" },
    signal: AbortSignal,
  ): Promise<AssembledEvaluation>;
  comparisons: ComparisonStore;
  saveSensitivity?(
    projectId: string,
    comparisonId: string,
    record: StoredComparison,
    signal: AbortSignal,
  ): Promise<void>;
  comparisonForRun(
    projectId: string,
    runId: string,
  ): Promise<StoredComparison | null>;
  jevConfigured: boolean;
};
const record = (value: unknown): Record<string, unknown> =>
  value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
export const milestoneOutput = (milestone: InvestigationMilestone) => {
  const summary = record(milestone.summary);
  return record("output" in summary ? summary.output : summary);
};
export const toolArtifactId = (kind: "profile" | "comparison", key: string) =>
  `investigation_${kind}_${createHash("sha256").update(key).digest("hex")}`;
const json = (value: unknown) =>
  z.json().parse(JSON.parse(JSON.stringify(value)));
class MissingInput extends Error {}
const descriptions: Record<InvestigationToolName, string> = {
  save_profile:
    "Apply a validated intake patch and save an immutable profile snapshot; report missing fields.",
  search_sites:
    "Search at most eight matching sites; return candidate IDs, rent/size/position and evidence IDs.",
  get_catchment:
    "Review a shortlisted site's source population, jobs, competitors and co-tenants.",
  poll_customers:
    "Explicitly poll Jev for selected sites; persist request answers and return table IDs and segment summaries.",
  evaluate_sites:
    "Evaluate shortlisted sites using prior poll cache only, or Huff; never make new paid panel calls.",
  run_sensitivity:
    "Test an assumption on this investigation's comparison and summarize ranking changes and break-even.",
  get_site_run:
    "Summarize a stored run's utilization, waits and abandonment by hour, with event IDs to cite.",
};

export function createInvestigationTools(
  deps: InvestigationToolDependencies,
): InvestigationToolRegistry {
  const definitions = (
    Object.keys(InvestigationToolSchemas) as InvestigationToolName[]
  ).map((name) => ({
    name,
    description: descriptions[name],
    schema: InvestigationToolSchemas[name],
  }));
  return {
    definitions,
    async execute(name, args, context): Promise<InvestigationToolResult> {
      context.signal.throwIfAborted();
      const parsed = InvestigationToolSchemas[name].parse(args);
      const outputs = context.milestones
        .filter(
          (m) =>
            m.attempt === context.job.attempt &&
            m.investigationId === context.job.id,
        )
        .map((m) => ({ tool: m.tool, output: milestoneOutput(m) }));
      const latest = (tool: string, profileId?: string) =>
        outputs
          .filter(
            (m) =>
              m.tool === tool &&
              (!profileId || m.output.profileId === profileId),
          )
          .at(-1)?.output;
      const profileId = latest("save_profile")?.profileId;
      const profile = await deps.loadProfile(
        context.job.projectId,
        typeof profileId === "string" ? profileId : context.job.profileId,
      );
      if (!profile || profile.projectId !== context.job.projectId)
        return {
          summary: { missingProfile: true },
          findings: [
            "The project profile is missing; save a completed intake before investigating.",
          ],
          done: true,
        };
      const current = BusinessProfileSchema.parse(profile);
      const selection = latest("search_sites", current.id);
      const selected = Array.isArray(selection?.siteIds)
        ? (selection.siteIds as string[])
        : [];
      const requireSites = (ids: string[]) => {
        if (ids.some((id) => !selected.includes(id)))
          throw new MissingInput(
            "Select sites from the current profile's search before using them.",
          );
      };
      const comparisonAllowed = (comparisonId: string) =>
        outputs.some(
          (m) =>
            m.tool === "evaluate_sites" &&
            m.output.comparisonId === comparisonId,
        );
      try {
        if (name === "save_profile") {
          const { patch } = parsed as z.infer<
            typeof InvestigationToolSchemas.save_profile
          >;
          const prior = latest("save_profile");
          const draft = IntakeDraftSchema.parse(
            Object.fromEntries(
              Object.entries(current).filter(
                ([key]) =>
                  !["id", "projectId", "synthetic", "version"].includes(key),
              ),
            ),
          );
          const state = prior?.intakeState
            ? (prior.intakeState as IntakeState)
            : { draft, assumptions: {} };
          const result = createIntakeSession(
            context.job.projectId,
            state,
          ).saveProfile(patch);
          if (!result.profile)
            return {
              summary: json({
                intakeState: {
                  draft: result.draft,
                  assumptions: result.assumptions,
                },
                missingRequiredFields: result.missingRequiredFields,
              }),
              findings: result.findings,
              done: true,
            };
          context.signal.throwIfAborted();
          const saved = await deps.saveProfile(
            context.job.projectId,
            { ...result.profile, synthetic: current.synthetic },
            context.idempotencyKey,
            context.signal,
          );
          if (!saved || saved.projectId !== context.job.projectId)
            throw new MissingInput("The project profile could not be saved.");
          return {
            summary: json({
              profileId: saved.id,
              profileVersion: saved.version,
              profile: saved,
              missingRequiredFields: [],
              intakeState: {
                draft: result.draft,
                assumptions: result.assumptions,
              },
            }),
            findings: result.findings,
          };
        }
        if (name === "search_sites") {
          const input = parsed as z.infer<
            typeof InvestigationToolSchemas.search_sites
          >;
          const found = await deps.search(
            current,
            input.filters,
            context.signal,
          );
          if (
            found.candidates.some(
              (c) => c.candidate.projectId !== context.job.projectId,
            )
          )
            throw new Error("Candidate project mismatch");
          return {
            summary: json({
              profileId: current.id,
              siteIds: found.candidates.map((c) => c.candidate.id),
              candidates: found.candidates.map((c) => ({
                siteId: c.candidate.id,
                rent: c.baseRentCents,
                size: c.candidate.floorAreaSqFt,
                position: c.position,
                flags: c.flags,
                evidenceIds: c.evidenceIds,
              })),
              filters: found.filters,
              emptyReason: found.emptyReason,
            }),
            ...(found.candidates.length
              ? {}
              : {
                  findings: [
                    found.emptyReason ??
                      "No matching sites; review the founder's search constraints.",
                  ],
                  done: true,
                }),
          };
        }
        if (name === "get_catchment") {
          const { site_id } = parsed as z.infer<
            typeof InvestigationToolSchemas.get_catchment
          >;
          requireSites([site_id]);
          const c = await deps.catchment(current, site_id, context.signal);
          if (
            c.catchment.projectId !== context.job.projectId ||
            c.catchment.siteId !== site_id
          )
            throw new Error("Catchment identity mismatch");
          return {
            summary: json({
              profileId: current.id,
              siteId: site_id,
              catchmentId: c.catchment.id,
              residentPopulation: c.residents.population,
              jobs: c.workers.jobs,
              vehiclesPerDay: c.passBy.vehiclesPerDay,
              competitors: c.competitors,
              coTenants: c.coTenants,
              evidenceIds: c.evidence.map((e) => e.id),
              limitations: c.limitations,
            }),
          };
        }
        if (name === "poll_customers") {
          const input = parsed as z.infer<
            typeof InvestigationToolSchemas.poll_customers
          >;
          requireSites(input.site_ids);
          const reviewed = outputs.filter(
            (m) =>
              m.tool === "get_catchment" && m.output.profileId === current.id,
          );
          if (
            input.site_ids.some(
              (id) => !reviewed.some((m) => m.output.siteId === id),
            )
          )
            throw new MissingInput(
              "Review each site's catchment before polling customers.",
            );
          const knownCompetitors = new Set(
            reviewed.flatMap((m) =>
              Array.isArray(m.output.competitors)
                ? m.output.competitors.map((c) => String(record(c).id))
                : [],
            ),
          );
          if (input.competitor_ids?.some((id) => !knownCompetitors.has(id)))
            throw new MissingInput(
              "Use competitor IDs from the reviewed catchments.",
            );
          const polled = await deps.assemble(
            current,
            input.site_ids,
            {
              mode: deps.jevConfigured ? "paid" : "huff",
              competitor_ids: input.competitor_ids,
              price: input.price,
            },
            context.signal,
          );
          const tables = polled.request.sites.map((site) => ({
            siteId: site.siteId,
            behaviorTableId: site.behaviorTableId ?? null,
            segments: ["resident", "worker", "passby"].flatMap((kind) => {
              const ids = new Set(
                polled.request.personaSet.personas
                  .filter((p) => p.kind === kind)
                  .map((p) => p.id),
              );
              const behaviors =
                site.behaviorTable?.personas.filter((p) =>
                  ids.has(p.personaId),
                ) ?? [];
              if (!behaviors.length) return [];
              const weights = new Map(
                polled.request.personaSet.personas.map((p) => [p.id, p.weight]),
              );
              const totalWeight = behaviors.reduce(
                (sum, b) => sum + (weights.get(b.personaId) ?? 0),
                0,
              );
              const mean = (
                value: (b: (typeof behaviors)[number]) => number,
              ) =>
                totalWeight > 0
                  ? behaviors.reduce(
                      (sum, b) =>
                        sum + value(b) * (weights.get(b.personaId) ?? 0),
                      0,
                    ) / totalWeight
                  : 0;
              const destinations = [
                ...new Set(behaviors.flatMap((p) => Object.keys(p.where))),
              ];
              return [
                {
                  segment: kind,
                  where: Object.fromEntries(
                    destinations.map((d) => [d, mean((b) => b.where[d] ?? 0)]),
                  ),
                  visitsPerMonth: mean((b) => b.visitsPerMonth),
                  timeBlocks: Object.fromEntries(
                    Object.keys(behaviors[0]!.timeBlocks).map((t) => [
                      t,
                      mean((b) => b.timeBlocks[t as keyof typeof b.timeBlocks]),
                    ]),
                  ),
                  stayCurve: behaviors[0]!.stayByLineLength.map((p, i) => ({
                    lineLength: p.lineLength,
                    p: mean((b) => b.stayByLineLength[i]?.p ?? 0),
                  })),
                },
              ];
            }),
            lowConfidencePersonaIds:
              site.behaviorTable?.personas
                .filter((p) => Object.values(p.confidence).some((v) => v < 0.5))
                .map((p) => p.personaId)
                .slice(0, 20) ?? [],
          }));
          return {
            summary: json({
              profileId: current.id,
              siteIds: input.site_ids,
              pollContext: {
                competitor_ids: input.competitor_ids,
                price: input.price,
              },
              tables,
              jevConfigured: deps.jevConfigured,
            }),
            findings: [
              ...polled.findings.map((f) => f.message),
              ...(!deps.jevConfigured
                ? [
                    "Jev is not configured; evaluation will use the Huff fallback.",
                  ]
                : []),
            ],
          };
        }
        if (name === "evaluate_sites") {
          const input = parsed as z.infer<
            typeof InvestigationToolSchemas.evaluate_sites
          >;
          requireSites(input.site_ids);
          const comparisonId = toolArtifactId(
            "comparison",
            context.idempotencyKey,
          );
          let stored = await deps.comparisons.load(
            context.job.projectId,
            comparisonId,
          );
          if (!stored) {
            const poll = latest("poll_customers", current.id);
            const pollIds = Array.isArray(poll?.siteIds)
              ? (poll.siteIds as string[])
              : [];
            const usablePoll = input.site_ids.every((id) =>
              pollIds.includes(id),
            );
            const pollContext = usablePoll
              ? (record(poll?.pollContext) as PollContext)
              : {};
            const demand =
              input.demand_source ?? (deps.jevConfigured ? "jev" : "huff");
            const assembled = await deps.assemble(
              current,
              input.site_ids,
              {
                ...pollContext,
                mode: demand === "jev" ? "cache-only" : "huff",
              },
              context.signal,
            );
            const request = {
              ...assembled.request,
              demandSource: demand,
              ...(input.seeds ? { seeds: input.seeds } : {}),
              ...(input.overrides ? { overrides: input.overrides } : {}),
            };
            context.signal.throwIfAborted();
            stored = buildStoredComparison(
              comparisonId,
              request,
              evaluateSites(request),
            );
            stored.evaluation.assembly = {
              findings: assembled.findings,
              assumptions: assembled.assumptions,
            };
            context.signal.throwIfAborted();
            try {
              await deps.comparisons.save(stored);
            } catch (error) {
              const existing = await deps.comparisons.load(
                context.job.projectId,
                comparisonId,
              );
              if (!existing) throw error;
              stored = existing;
            }
          }
          const result = stored.evaluation.result;
          return {
            summary: json({
              comparisonId: stored.id,
              profileId: stored.evaluation.request.profileId,
              siteIds: result.ranking,
              ranking: result.ranking,
              demandSource: result.demandSource,
              fallbackReason: result.fallbackReason,
              sites: result.sites.map((s) => ({
                siteId: s.siteId,
                rank: s.rank,
                tiedWith: s.tiedWith,
                contributionUsd: s.monthlyContributionUsd,
                revenueUsd: s.monthlyRevenueUsd,
                waitMin: s.weekdayMeanWaitMin,
                abandonment: s.weekdayAbandonmentRate,
                utilization: s.weekdayUtilization,
                runIds: [
                  s.representative.weekday.runId,
                  s.representative.weekend.runId,
                ],
              })),
              huffCheck: demandSourceCheck(stored.evaluation.request),
            }),
            findings: stored.evaluation.assembly?.findings.map(
              (f) => f.message,
            ),
          };
        }
        if (name === "run_sensitivity") {
          const input = parsed as z.infer<
            typeof InvestigationToolSchemas.run_sensitivity
          >;
          if (!comparisonAllowed(input.comparison_id))
            throw new MissingInput(
              "Use a comparison created by this investigation.",
            );
          const stored = await deps.comparisons.load(
            context.job.projectId,
            input.comparison_id,
          );
          if (
            !stored ||
            stored.evaluation.request.projectId !== context.job.projectId
          )
            throw new MissingInput(
              "The comparison is unavailable in this project.",
            );
          context.signal.throwIfAborted();
          const sensitivity = runSensitivity(
            stored.evaluation.request,
            input.assumption,
            input.values,
            { seeds: input.seeds },
          );
          context.signal.throwIfAborted();
          const next = withSensitivity(stored, sensitivity);
          if (deps.saveSensitivity)
            await deps.saveSensitivity(
              context.job.projectId,
              stored.id,
              next,
              context.signal,
            );
          else
            await deps.comparisons.saveSensitivity(
              context.job.projectId,
              stored.id,
              next,
            );
          return { summary: json({ comparisonId: stored.id, ...sensitivity }) };
        }
        const { run_id } = parsed as z.infer<
          typeof InvestigationToolSchemas.get_site_run
        >;
        const stored = await deps.comparisonForRun(
          context.job.projectId,
          run_id,
        );
        if (
          !stored ||
          !comparisonAllowed(stored.id) ||
          stored.evaluation.request.projectId !== context.job.projectId
        )
          throw new MissingInput(
            "Use a stored run from this investigation's comparisons.",
          );
        const summary = siteRunSummary(stored.evaluation.result, run_id);
        if (!summary)
          throw new MissingInput(
            "No representative site run matches that identifier.",
          );
        return {
          summary: json({
            ...summary,
            eventIds: summary.eventIds.slice(0, 100),
            totalEventIds: summary.eventIds.length,
          }),
        };
      } catch (error) {
        if (error instanceof AssemblyError)
          return {
            summary: json({
              missingInput: true,
              excludedInputs: error.findings,
            }),
            findings: [
              error.message,
              ...error.findings.map((finding) => finding.message),
              "What verified rent, size, operating-cost, buildout or catchment inputs can you provide for these sites?",
            ],
            done: true,
          };
        if (error instanceof MissingInput)
          return {
            summary: { missingInput: true },
            findings: [error.message],
            done: true,
          };
        throw error;
      }
    },
  };
}
