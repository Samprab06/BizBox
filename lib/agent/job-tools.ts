/**
 * HAC-151 (AGT-21): the intake agent's `jobs` tool group. These tools do work, not just
 * navigation: replace the comparison shortlist, run a comparison, start an investigation,
 * open the plan. Like the `ui` group (ui-tools.ts) they validate on the server, queue
 * `UiAction`s into the turn's collector, are idempotent within a turn, and return tool
 * errors as text instead of failing the turn. SDK-free; `runner.ts` wraps the specs.
 *
 * Nothing slow runs inside the 30 s turn: the comparison runs on the client (the existing
 * comparison path) and the investigation planner runs through `/advance`, driven by
 * `ConsultantPanel`. This module only persists the profile and creates the stored job.
 */
import { z } from "zod";
import type { BusinessProfile } from "@/lib/contracts";
import { MAX_UI_ACTIONS, type UiAction } from "@/lib/contracts/agent";
import { MAX_COMPARE_UNITS } from "@/lib/contracts/evaluation";
import type { InvestigationJob } from "@/lib/contracts/investigations";
import type { ProfileStore } from "@/lib/profiles/store";
import type { IntakeUiContext } from "./ui-tools";

/** The agent may start at most this many investigations per project in 24 hours. */
export const MAX_INVESTIGATION_STARTS_PER_DAY = 3;
export const INVESTIGATION_START_WINDOW_MS = 24 * 60 * 60_000;
export const DEFAULT_INVESTIGATION_QUESTION =
  "Which of the candidate spaces best fits this business, and why?";

/** Server-side ports for the jobs the agent starts. Postgres versions live in job-tools-postgres.ts. */
export type JobsPort = {
  /** Persists the completed profile as an immutable snapshot; null when the project is gone. */
  saveProfile(
    projectId: string,
    profile: BusinessProfile,
  ): Promise<{ id: string } | null>;
  /** Starts the job unless the project already has one active or hit the daily cap. */
  startInvestigation(input: {
    projectId: string;
    profileId: string;
    question: string;
  }): Promise<
    | { status: "started"; investigationId: string }
    | { status: "active"; investigationId: string }
    | { status: "daily_limit"; limit: number }
  >;
};

/** Counts the caps need; the Postgres version reads the `investigations` table. */
export type InvestigationCounts = {
  activeFor(projectId: string): Promise<string | null>;
  startsSince(projectId: string, since: Date): Promise<number>;
};

export function createJobsPort(deps: {
  profiles: Pick<ProfileStore, "saveSnapshot">;
  create(input: {
    projectId: string;
    profileId: string;
    question: string;
  }): Promise<Pick<InvestigationJob, "id">>;
  counts: InvestigationCounts;
  limit?: number;
  now?: () => Date;
}): JobsPort {
  const limit = deps.limit ?? MAX_INVESTIGATION_STARTS_PER_DAY;
  const now = deps.now ?? (() => new Date());
  // Serialises check-then-create per project inside one server instance.
  const queues = new Map<string, Promise<unknown>>();
  const serial = <T>(key: string, run: () => Promise<T>): Promise<T> => {
    const next = (queues.get(key) ?? Promise.resolve()).then(run, run);
    queues.set(
      key,
      next.catch(() => undefined),
    );
    return next;
  };
  return {
    async saveProfile(projectId, profile) {
      const saved = await deps.profiles.saveSnapshot(projectId, profile);
      return saved ? { id: saved.id } : null;
    },
    startInvestigation: (input) =>
      serial(input.projectId, async () => {
        const active = await deps.counts.activeFor(input.projectId);
        if (active) return { status: "active", investigationId: active };
        const since = new Date(now().getTime() - INVESTIGATION_START_WINDOW_MS);
        if ((await deps.counts.startsSince(input.projectId, since)) >= limit)
          return { status: "daily_limit", limit };
        const job = await deps.create(input);
        return { status: "started", investigationId: job.id };
      }),
  };
}

/** Candidate IDs are `listingId:spaceId`, the shape the comparison path accepts. */
const SiteIds = z
  .array(z.string().trim().regex(/^\d+:\d+$/, "must look like 123:456"))
  .min(1)
  .max(MAX_COMPARE_UNITS);
const SPECS = {
  set_shortlist: {
    schema: z.object({ siteIds: SiteIds }),
    description: `Replace the founder's comparison shortlist (1-${MAX_COMPARE_UNITS} candidate sites): swap, add or drop a site. Use only site IDs from the screen context or tool results.`,
  },
  run_comparison: {
    schema: z.object({ siteIds: SiteIds.optional() }),
    description:
      "Run (or rerun) the comparison only after the founder has agreed to it in their message. Omit siteIds to use the shortlist you just set, the view's shortlist, or the top candidates. It runs in the founder's browser on the compare step.",
  },
  start_investigation: {
    schema: z.object({ question: z.string().trim().min(1).max(500).optional() }),
    description:
      "Start a background investigation of the candidate spaces. Needs a complete profile; otherwise it lists what is missing, so ask the founder for those. At most one at a time per project.",
  },
  open_plan: {
    schema: z.object({}),
    description: "Open the location plan for the founder's current comparison.",
  },
} as const;
export type JobToolName = keyof typeof SPECS;
export const JOB_TOOL_NAMES = Object.keys(SPECS) as JobToolName[];
/**
 * Scene 1: the job tools the guided-flow consultant is given. start_investigation and
 * open_plan open legacy pages (the investigation comparison and the plan page), so they are
 * no longer bound; finalize_plan (flow-tools.ts) ends the flow instead.
 */
export const FLOW_JOB_TOOL_NAMES: readonly JobToolName[] = [
  "set_shortlist",
  "run_comparison",
];
export const JOB_TOOL_SPECS = JOB_TOOL_NAMES.map((name) => {
  const schema = z.toJSONSchema(SPECS[name].schema) as Record<string, unknown>;
  delete schema.$schema;
  return { name, description: SPECS[name].description, schema };
});

class Rejected extends Error {}
const budget = `Error: UI action limit (${MAX_UI_ACTIONS}) reached for this turn. Do not call more tools; reply to the founder now.`;

/** What the executor needs from the intake session, read lazily so a save mid-turn counts. */
export type JobSessionView = {
  profile(): BusinessProfile | null;
  missing(): readonly string[];
  draftCity(): string | undefined;
};

export function createJobToolExecutor(
  context: IntakeUiContext & { jobs: JobsPort },
  session: JobSessionView,
) {
  const { actions, jobs, lookups, projectId } = context;
  // One result per distinct call: a repeated tool call in the same turn has no extra effect.
  const done = new Map<string, Promise<string>>();
  let shortlist: string[] | undefined;
  let shortlistCall: Promise<string> | undefined;
  const queue = (action: UiAction) => {
    const same = JSON.stringify({ ...action, id: undefined });
    if (actions.some((a) => JSON.stringify({ ...a, id: undefined }) === same))
      return;
    if (actions.length >= MAX_UI_ACTIONS) throw new Rejected(budget);
    actions.push(action);
  };
  const checkSites = async (siteIds: string[]) => {
    const city = session.draftCity();
    for (const siteId of siteIds) {
      const site = await lookups.site(siteId);
      if (!site) throw new Rejected(`Unknown site ID ${siteId}.`);
      if (
        city &&
        site.city?.trim() &&
        site.city.trim().toLowerCase() !== city.toLowerCase()
      )
        throw new Rejected(`Site ${siteId} is not in ${city}.`);
    }
  };

  const tools: Record<JobToolName, (args: Record<string, unknown>) => Promise<string>> = {
    async set_shortlist(args) {
      const { siteIds } = SPECS.set_shortlist.schema.parse(args);
      const ids = [...new Set(siteIds)];
      await checkSites(ids);
      queue({ id: context.newId(), type: "set_shortlist", siteIds: ids });
      shortlist = ids;
      return `Queued: the shortlist becomes ${ids.length} site(s). Next, run_comparison if the founder asked to compare.`;
    },
    async run_comparison(args) {
      const parsed = SPECS.run_comparison.schema.parse(args);
      if (!parsed.siteIds) {
        // The model may issue set_shortlist and run_comparison in one step; let the former land.
        await new Promise((resolve) => setTimeout(resolve, 0));
        await shortlistCall;
      }
      const ids = [
        ...new Set(
          parsed.siteIds ??
            shortlist ??
            (context.view?.shortlistIds?.length
              ? context.view.shortlistIds
              : undefined) ??
            context.view?.candidateIds ??
            context.view?.candidates?.map((site) => site.id) ??
            [],
        ),
      ].slice(0, MAX_COMPARE_UNITS);
      if (!ids.length)
        throw new Rejected(
          "No sites to compare. Call set_shortlist first or ask the founder which sites.",
        );
      if (!session.profile())
        throw new Rejected(
          `The profile is not complete (missing: ${session.missing().join(", ") || "unknown"}). Ask the founder for those first.`,
        );
      await checkSites(ids);
      queue({ id: context.newId(), type: "run_comparison", siteIds: ids });
      return `Queued: the comparison of ${ids.length} site(s) starts in the founder's browser on the compare step. Tell the founder it is running and can take a few minutes.`;
    },
    async start_investigation(args) {
      const { question } = SPECS.start_investigation.schema.parse(args);
      const profile = session.profile();
      if (!profile)
        throw new Rejected(
          `The profile is not complete, so no investigation was started. Missing: ${session.missing().join(", ") || "unknown"}. Ask the founder for those.`,
        );
      if (actions.length >= MAX_UI_ACTIONS) throw new Rejected(budget);
      const saved = await jobs.saveProfile(projectId, profile);
      if (!saved) throw new Rejected("The project was not found.");
      const result = await jobs.startInvestigation({
        projectId,
        profileId: saved.id,
        question: question ?? DEFAULT_INVESTIGATION_QUESTION,
      });
      if (result.status === "daily_limit")
        throw new Rejected(
          `The daily limit of ${result.limit} investigations is reached. Tell the founder; do not retry.`,
        );
      queue({
        id: context.newId(),
        type: "show_comparison",
        investigationId: result.investigationId,
      });
      return result.status === "active"
        ? "An investigation is already running for this project; showing it instead of starting another."
        : "Started: the investigation runs in the background and its progress shows in the consultant panel. Tell the founder.";
    },
    async open_plan() {
      const comparisonId = context.view?.comparisonId;
      if (!comparisonId)
        throw new Rejected(
          "There is no current comparison to open a plan for. Run a comparison first.",
        );
      if (!(await lookups.comparisonExists(projectId, comparisonId)))
        throw new Rejected(
          `Comparison ${comparisonId} does not belong to this project.`,
        );
      queue({ id: context.newId(), type: "show_plan", comparisonId });
      return "Queued: the founder's screen will show the location plan.";
    },
  };

  return function run(name: JobToolName, rawArgs: unknown): Promise<string> {
    const args =
      rawArgs && typeof rawArgs === "object" && !Array.isArray(rawArgs)
        ? (rawArgs as Record<string, unknown>)
        : {};
    const key = `${name}:${JSON.stringify(args)}`;
    const previous = done.get(key);
    if (previous) return previous.then((r) => `Already done this turn. ${r}`);
    const attempt = tools[name](args).catch((error: unknown) => {
      // A failed call can be corrected and retried; a successful one cannot repeat.
      done.delete(key);
      if (error instanceof Rejected) return error.message.startsWith("Error:") ? error.message : `Error: ${error.message} Nothing was done.`;
      if (error instanceof z.ZodError)
        return `Error: invalid ${name} arguments (${error.issues
          .slice(0, 3)
          .map((i) => `${i.path.join(".") || "args"} ${i.message}`)
          .join("; ")}). Nothing was done.`;
      return `Error: ${name} could not run right now. Nothing was done; do not retry this turn.`;
    });
    done.set(key, attempt);
    if (name === "set_shortlist") shortlistCall = attempt;
    return attempt;
  };
}
