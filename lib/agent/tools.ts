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
  demandPersonaSet,
} from "@/lib/contracts/evaluation";
import type { SiteSearchResult } from "@/lib/contracts/sites";
import type { CatchmentResponse } from "@/lib/contracts/catchment";
import type { InvestigationJob, InvestigationMilestone } from "./jobs";
import {
  AssemblyError,
  type AssembledEvaluation,
  type PanelDeadline,
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
import {
  NessieConsultantResultSchema,
  type NessieConsultantResult,
  type NessieConsultantScenario,
} from "@/lib/contracts/nessie";
import type { NessieConsultantReadInput } from "@/lib/nessie/consultant";

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
  read_nessie_cash_buffer: z
    .object({
      account_id: z
        .string()
        .regex(/^[A-Za-z0-9_-]{1,128}$/)
        .optional(),
      comparison_id: id.optional(),
      site_id: siteIds.element.optional(),
    })
    .strict()
    .refine(
      (a) => Boolean(a.comparison_id) === Boolean(a.site_id),
      "comparison_id and site_id must be supplied together",
    ),
};
export type InvestigationToolName = keyof typeof InvestigationToolSchemas;
export type InvestigationToolContext = {
  job: InvestigationJob;
  milestones: InvestigationMilestone[];
  signal: AbortSignal;
  idempotencyKey: string;
  /** Epoch ms the step should finish by; a Jev panel stops asking near it (HAC-155). */
  deadlineAt?: number;
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
    deadline?: PanelDeadline,
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
  readNessieCashBuffer?(
    input: NessieConsultantReadInput,
  ): Promise<NessieConsultantResult>;
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
  read_nessie_cash_buffer:
    "Read the shared simulated Nessie cash buffer; for site affordability supply this investigation's current comparison_id and site_id. Buildout and contribution come only from saved evaluation, never model amounts. Multiple accounts require an explicit demo choice.",
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
        if (name === "read_nessie_cash_buffer") {
          const input = parsed as z.infer<
            typeof InvestigationToolSchemas.read_nessie_cash_buffer
          >;
          const identity = {
            investigationId: context.job.id,
            attempt: context.job.attempt,
            projectId: current.projectId,
            profileId: current.id,
            profileVersion: current.version,
          };
          const empty = (
            status: NessieConsultantResult["status"],
            message: string,
          ) =>
            NessieConsultantResultSchema.parse({
              ...identity,
              kind: "nessie_cash_buffer",
              source: "nessie",
              synthetic: true,
              status,
              message,
              accounts: [],
              selectedAccount: null,
              snapshot: null,
              scenario: null,
            });
          const completed = (
            value: NessieConsultantResult,
          ): InvestigationToolResult => {
            const r = NessieConsultantResultSchema.parse(value);
            if (
              Object.entries(identity).some(
                ([key, value]) => r[key as keyof typeof identity] !== value,
              )
            )
              throw new Error("Nessie evidence identity mismatch");
            const findings = [r.message];
            const money = (cents: number) =>
              (cents / 100).toLocaleString("en-US", {
                style: "currency",
                currency: "USD",
              });
            if (r.status === "ready" && r.selectedAccount && r.snapshot) {
              findings.push(
                `Capital One Nessie simulated cash for demo account ${r.selectedAccount.id}: available ${money(r.selectedAccount.availableCents)} at ${r.snapshot.asOf}; last-30-day inflow ${money(r.snapshot.inflowCents)}, outflow ${money(r.snapshot.outflowCents)}. Upcoming bills ${money(r.snapshot.upcomingBillsCents)} are context only, not extra costs deducted from the scenario.`,
              );
              if (r.scenario)
                findings.push(
                  `Simulated cash scenario for comparison ${r.scenario.comparisonId}, site ${r.scenario.siteId}: modeled upfront buildout ${money(r.scenario.modeledUpfrontBuildoutCents)}; cash after one month ${money(r.scenario.projection.cashAfterOneMonthCents.mean)} (modeled interval ${money(r.scenario.projection.cashAfterOneMonthCents.low)} to ${money(r.scenario.projection.cashAfterOneMonthCents.high)}). This is a scenario, not a forecast or a real financing approval.`,
                );
            }
            return { summary: json(r), findings };
          };
          let scenario:
            Omit<NessieConsultantScenario, "projection"> | undefined;
          if (input.comparison_id && input.site_id) {
            const milestones = context.milestones
              .filter(
                (m) =>
                  m.investigationId === context.job.id &&
                  m.attempt === context.job.attempt,
              )
              .sort((a, b) => a.seq - b.seq);
            const profileSeq =
              milestones
                .filter(
                  (m) =>
                    m.tool === "save_profile" &&
                    typeof milestoneOutput(m).profileId === "string",
                )
                .at(-1)?.seq ?? -1;
            const allowed = milestones.some((m) => {
              const output = milestoneOutput(m);
              return (
                m.seq > profileSeq &&
                m.tool === "evaluate_sites" &&
                output.comparisonId === input.comparison_id &&
                output.profileId === current.id &&
                (output.projectId === undefined ||
                  output.projectId === current.projectId)
              );
            });
            if (!allowed)
              return completed(
                empty(
                  "comparison_unavailable",
                  "Cash affordability requires a comparison produced by this investigation's current attempt and profile. Run the comparison first; no Nessie cash recommendation was made.",
                ),
              );
            try {
              const stored = await deps.comparisons.load(
                current.projectId,
                input.comparison_id,
              );
              context.signal.throwIfAborted();
              const request = stored?.evaluation.request;
              const result = stored?.evaluation.result;
              const sourceSite = request?.sites.find(
                (site) => site.siteId === input.site_id,
              );
              const outcome = result?.sites.find(
                (site) => site.siteId === input.site_id,
              );
              if (
                !stored ||
                stored.id !== input.comparison_id ||
                request?.projectId !== current.projectId ||
                request.profileId !== current.id ||
                request.profileVersion !== current.version ||
                result?.projectId !== current.projectId ||
                result.profileId !== current.id ||
                result.profileVersion !== current.version ||
                !sourceSite ||
                !outcome
              )
                throw new Error("Invalid comparison scope");
              const upfront = Math.round(
                sourceSite.config.lease.buildoutUsd * 100,
              );
              if (!Number.isSafeInteger(upfront) || upfront < 0)
                throw new Error("Invalid modeled buildout");
              const { low, mean, high } = outcome.monthlyContributionUsd;
              scenario = {
                comparisonId: stored.id,
                siteId: outcome.siteId,
                modeledUpfrontBuildoutCents: upfront,
                monthlyContributionUsd: { low, mean, high },
              };
            } catch {
              context.signal.throwIfAborted();
              return completed(
                empty(
                  "comparison_unavailable",
                  "The stored comparison or site is unavailable for the current project/profile. Rerun it before making a cash-affordability comparison.",
                ),
              );
            }
          }
          if (!deps.readNessieCashBuffer)
            return completed(
              empty(
                "unconfigured",
                "Nessie simulated cash evidence is unavailable. Continue the location investigation without a cash-affordability claim.",
              ),
            );
          try {
            const result = await deps.readNessieCashBuffer({
              ...identity,
              ...(input.account_id ? { accountId: input.account_id } : {}),
              ...(scenario ? { scenario } : {}),
              signal: context.signal,
            });
            context.signal.throwIfAborted();
            return completed(result);
          } catch {
            context.signal.throwIfAborted();
            return completed(
              empty(
                "provider_error",
                "Nessie could not return valid simulated cash evidence. Continue without a cash-affordability claim; no banking result was invented.",
              ),
            );
          }
        }
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
            { deadlineAt: context.deadlineAt, signal: context.signal },
          );
          const tables = polled.request.sites.map((site) => {
            const personas = demandPersonaSet(
              polled.request,
              site,
              "jev",
            ).personas;
            return {
              siteId: site.siteId,
              behaviorTableId: site.behaviorTableId ?? null,
              segments: ["resident", "worker", "passby"].flatMap((kind) => {
                const ids = new Set(
                  personas.filter((p) => p.kind === kind).map((p) => p.id),
                );
                const behaviors =
                  site.behaviorTable?.personas.filter((p) =>
                    ids.has(p.personaId),
                  ) ?? [];
                if (!behaviors.length) return [];
                const weights = new Map(personas.map((p) => [p.id, p.weight]));
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
                      destinations.map((d) => [
                        d,
                        mean((b) => b.where[d] ?? 0),
                      ]),
                    ),
                    visitsPerMonth: mean((b) => b.visitsPerMonth),
                    timeBlocks: Object.fromEntries(
                      Object.keys(behaviors[0]!.timeBlocks).map((t) => [
                        t,
                        mean(
                          (b) => b.timeBlocks[t as keyof typeof b.timeBlocks],
                        ),
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
                  .filter((p) =>
                    Object.values(p.confidence).some((v) => v < 0.5),
                  )
                  .map((p) => p.personaId)
                  .slice(0, 20) ?? [],
            };
          });
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
              ...(assembled.jevCompetitorSet
                ? { jevCompetitorSet: assembled.jevCompetitorSet }
                : {}),
              ...(assembled.jevPersonaSet
                ? { jevPersonaSet: assembled.jevPersonaSet }
                : {}),
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

// HAC-82: injectable scenario tools, separate from the budgeted HAC-23 job runtime.
export { createCopilotMutationTools } from "./copilot-tools";
export { createCopilotTools } from "./copilot-registry";
export { createCopilotReadTools } from "./copilot-read-tools";
export { createCopilotRunTools } from "./copilot-run-tools";
export { resolveCopilotReference } from "./copilot-references";
export type {
  CopilotMutationContext,
  CopilotMutationDependencies,
} from "./copilot-tools";
