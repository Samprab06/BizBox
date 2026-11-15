import "server-only";
import { ChatOpenAI } from "@langchain/openai";
import { BaseCallbackHandler } from "@langchain/core/callbacks/base";
import type { LLMResult } from "@langchain/core/outputs";
import { tool } from "@langchain/core/tools";
import { createDeepAgent, type CreateDeepAgentParams } from "deepagents";
import { z } from "zod";
import { IntakePatchSchema } from "@/lib/contracts/intake";
import { INTAKE_QUESTIONS } from "./intake";
import {
  createJobToolExecutor,
  FLOW_JOB_TOOL_NAMES,
  JOB_TOOL_SPECS,
} from "./job-tools";
import {
  createUiToolExecutor,
  FLOW_UI_TOOL_NAMES,
  UI_TOOL_SPECS,
} from "./ui-tools";
import {
  createFlowToolExecutor,
  FLOW_EVENT_TOOL_NAMES,
  FLOW_TOOL_SPECS,
  flowEventNote,
} from "./flow-tools";
import {
  intakeBrief,
  stripUnsupportedUnknowns,
  withFounderProvenance,
} from "./intake-guard";

export const DEFAULT_INTAKE_MODEL = "gpt-6-luna";
/** Unset means the native OpenAI endpoint. */
export function modelConfiguration(env: Record<string, string | undefined>) {
  const baseURL = env.OPENAI_BASE_URL?.trim();
  return {
    timeout: 10_000,
    maxRetries: 0,
    ...(baseURL ? { baseURL } : {}),
  };
}
/**
 * Graph step budget for one consultant turn. A normal turn is one save and a reply (about 4
 * steps); HAC-144 adds room for up to three UI actions, which usually share one model step.
 * Event turns use the same budget without save_profile.
 */
export const INTAKE_RECURSION_LIMIT = 16;
/** One save_profile call per turn is normal; a second covers a rejected or corrected patch. */
export const INTAKE_MAX_SAVES = 2;
import type { IntakeRunner } from "./runtime-loader";
export { INTAKE_TIMEOUT_MS, type IntakeRunner } from "./runtime-loader";

/**
 * Scene 1: the one consultant's guided flow. The five step names match FLOW_STEP_IDS
 * (lib/contracts/agent.ts), which the stepper shows and go_to_step accepts.
 */
export const FLOW_INSTRUCTIONS = `You are BizBox's location consultant: one warm, concise guide helping a founder choose a space for a service business in Houston or Los Angeles. You lead them through five steps, shown in the stepper at the top of the screen:
1. questions: the structured questionnaire. The founder fills it in; you are not shown there.
2. locations: when the founder arrives in the workspace, present the top 3 candidates from the view (address, monthly rent, size) and ask whether to run a side-by-side comparison of them. Do not run it until they agree.
3. compare: once they agree, start the comparison. It runs in their browser and can take minutes. While it runs, explain what the simulation does in short turns, in this order: the Jev persona panel answers visit questions; the answers become demand per site; a queue and service simulation runs over many seeded days; the days roll up into monthly economics.
4. results: when it finishes, read the results and present them: which site leads (or that it is a close call when ranges overlap), customers and contribution per month as low-high ranges, weekday wait, and how confident the estimate is (number of seeded scenarios, ties, Jev panel or the distance-based fallback). Point them to one thing to inspect. Then ask whether they want to change anything: swap, add or drop a site, or change one site's hours, price, staffing or rent. After they confirm, rerun. This loops as often as they like.
5. finalize: when the founder is happy with a site, finalize the plan with the chosen site and a one or two sentence rationale, which opens the Final plan summary.
How you speak: short replies (two to four sentences unless presenting results), plain language, round numbers ("about 1,200 customers a month", "$4,000 to $9,000 a month"). Every customer, revenue, contribution and wait figure is a modeled estimate, not measured traffic: say "modeled" or "estimated" and give the range. Never invent numbers, addresses, IDs or facts: use only the validated view, the draft and tool results, and say so when something is missing. Always ask before running or rerunning a comparison. Stay in the workspace: never send the founder to other pages.`;

/** Message turns: the founder may still state or correct profile facts. */
const profileInstructions = `Profile facts: when the founder states or corrects a profile fact (name, concept, city, areas, budgets, price, customers, hours, staff, must-haves), call save_profile ONCE with exactly what they said. If the profile is still incomplete, ask the returned nextQuestion. The draft in the message is already validated; do not call save_profile to verify. The questionnaire groups are:
${INTAKE_QUESTIONS.map((group) => `- ${group.question}`).join("\n")}
Never invent names, objectives, cities, staff, hours, customers, budgets or must-haves. Leave anything the founder did not address out of the patch: it stays undefined.
"Unknown" (value null with unknownReason) needs the founder's own words, such as "I don't know my rent budget yet". A field the founder did not mention is NOT unknown; the tool drops those.
Entries are {value,unit,unknownReason?}; origin is added for you. Money is USD cents; times are integer minutes since midnight, closing after opening the same day. Supported categories: coffee, quick_food, salon_barber, fitness; save any other category verbatim.
Category defaults (service, travel, patience, visits, peak hours, wage, COGS, floor area) are illustrative assumptions, not calibrated observations or forecasts: call them defaults and invite review. Founder statements override any default; service time goes under capacity, wage/COGS/travel/patience under derivedDefaults, visits/peak/area under assumptions.
Do not change origins, research sources, access files, delegate, or call services other than the tools you are given.`;

/** Event turns: a browser event, never founder speech or consent. */
const eventInstructions = `This turn is a flow event from the founder's browser, marked "[flow event]". It is not the founder speaking and never counts as their agreement: do not run, rerun, tweak or finalize anything, and do not save profile facts. React as the note asks, in the founder-facing voice above.`;

/** Scene 1: added when the UI tools are bound. */
const uiInstructions = `Screen tools: ${FLOW_UI_TOOL_NAMES.join(", ")} act inside the workspace (open_site opens the property panel; highlight points at comparison_table, comparison_recommendation, site_economics, candidate_list, map or assumptions). Flow tools: present_top_sites shows the top locations on the locations step; go_to_step moves the stepper (questions, locations, compare, results, finalize); read_comparison_results reads a finished comparison; set_site_tweaks queues one site's hours, price, staff or rent for the next run; finalize_plan ends the flow with the founder's chosen site. At most 3 screen actions per turn. Use only site and comparison IDs from the view, flow events or tool results; never invent IDs. If a tool is rejected, say so instead of retrying.`;

/** Scene 1: added when the jobs port is bound (message turns only). */
const jobInstructions = `Comparison tools: when the founder agrees to compare (for example "yes", "go ahead", "compare them"), call set_shortlist with the presented sites (at most 3; the view's shortlistIds or top candidates), then run_comparison, then go_to_step compare, and tell them it is running and may take a few minutes. To swap, add or drop a site, set_shortlist with the new list; to change a site's hours, price, staff or rent, set_site_tweaks. Then ask before rerunning; run_comparison only once they confirm. When the founder picks a site from the results, finalize_plan with the comparison in the view. Do not repeat a call.`;

/** Model-facing tool schema: the contract's JSON schema without server-owned provenance. */
function slimPatchSchema(): Record<string, unknown> {
  const prune = (node: unknown): unknown => {
    if (Array.isArray(node)) return node.map(prune);
    if (node === null || typeof node !== "object") return node;
    const entry = { ...(node as Record<string, unknown>) };
    delete entry.$schema;
    delete entry.additionalProperties;
    const properties = entry.properties as Record<string, unknown> | undefined;
    if (properties && "origin" in properties && "evidenceIds" in properties) {
      const rest = { ...properties };
      delete rest.origin;
      delete rest.evidenceIds;
      entry.properties = rest;
      entry.required = (entry.required as string[] | undefined)?.filter(
        (key) => key !== "origin" && key !== "evidenceIds",
      );
    }
    for (const key of Object.keys(entry)) entry[key] = prune(entry[key]);
    return entry;
  };
  return prune(
    z.toJSONSchema(IntakePatchSchema, { unrepresentable: "any" }),
  ) as Record<string, unknown>;
}
export const PATCH_JSON_SCHEMA = slimPatchSchema();

type TurnUsage = {
  modelCalls: number;
  inputTokens: number;
  outputTokens: number;
  totalTokens: number;
};
/** Sums provider-reported token usage per model call. Counts only; never prompt text. */
class UsageTally extends BaseCallbackHandler {
  name = "intake_usage_tally";
  awaitHandlers = true;
  usage: TurnUsage = {
    modelCalls: 0,
    inputTokens: 0,
    outputTokens: 0,
    totalTokens: 0,
  };
  handleLLMEnd(output: LLMResult) {
    this.usage.modelCalls += 1;
    for (const generation of output.generations.flat()) {
      const metadata = (
        generation as { message?: { usage_metadata?: Record<string, number> } }
      ).message?.usage_metadata;
      if (!metadata) continue;
      this.usage.inputTokens += metadata.input_tokens ?? 0;
      this.usage.outputTokens += metadata.output_tokens ?? 0;
      this.usage.totalTokens +=
        metadata.total_tokens ??
        (metadata.input_tokens ?? 0) + (metadata.output_tokens ?? 0);
    }
  }
}

function logTurn(fields: Record<string, unknown>) {
  console.info(JSON.stringify({ event: "intake_turn", ...fields }));
}

export function createDeepIntakeRunner(
  model: NonNullable<CreateDeepAgentParams["model"]>,
): IntakeRunner {
  return async ({ session, message, event, signal, ui, viewContextLine }) => {
    let saves = 0;
    let saved = 0;
    let rejectedUnknowns = 0;
    const pendingFields: readonly string[] =
      session.snapshot().nextQuestion?.fields ?? [];
    const fallbackReply = () =>
      session.snapshot().nextQuestion?.question ??
      "Your answers have been recorded in this draft. Review the findings and defaults.";
    const saveProfile = tool(
      (rawPatch) => {
        signal.throwIfAborted();
        // Return tool errors as text so the model can answer instead of the run failing.
        if (++saves > INTAKE_MAX_SAVES)
          return "Error: save_profile limit reached for this turn. Do not call it again; reply to the founder now.";
        const { patch, dropped } = stripUnsupportedUnknowns(
          rawPatch,
          message,
          pendingFields,
        );
        rejectedUnknowns += dropped.length;
        const note = dropped.length
          ? `Ignored unknowns the founder did not state (${dropped.join(", ")}); those fields stay undefined. Ask about them instead.`
          : undefined;
        if (patch === null)
          return JSON.stringify({
            saved: false,
            error: note ?? "Nothing to save.",
          });
        try {
          const result = session.saveProfile(withFounderProvenance(patch));
          saved += 1;
          return JSON.stringify({
            saved: true,
            ...intakeBrief(result),
            ...(note ? { note } : {}),
          });
        } catch (error) {
          if (error instanceof z.ZodError)
            return JSON.stringify({
              saved: false,
              error: `Invalid values: ${error.issues
                .slice(0, 5)
                .map(
                  (issue) =>
                    `${issue.path.join(".") || "patch"} ${issue.message}`,
                )
                .join("; ")}`,
            });
          throw error;
        }
      },
      {
        name: "save_profile",
        description:
          "Merge the founder's stated answers into the interview draft. Send only fields they addressed; never an unknown they did not state. Returns what is saved, missing fields and the next question.",
        schema: PATCH_JSON_SCHEMA,
      },
    );
    const draftCity = () => session.snapshot().draft.city;
    const runUiTool = ui ? createUiToolExecutor(ui, draftCity) : undefined;
    const uiTools = runUiTool
      ? UI_TOOL_SPECS.filter((spec) =>
          FLOW_UI_TOOL_NAMES.includes(spec.name),
        ).map((spec) =>
          tool((args) => {
            signal.throwIfAborted();
            return runUiTool(spec.name, args);
          }, spec),
        )
      : [];
    const runFlowTool = ui
      ? createFlowToolExecutor(ui, { draftCity })
      : undefined;
    const flowTools = runFlowTool
      ? FLOW_TOOL_SPECS.filter(
          (spec) => !event || FLOW_EVENT_TOOL_NAMES.includes(spec.name),
        ).map((spec) =>
          tool(
            (args) => {
              signal.throwIfAborted();
              return runFlowTool(spec.name, args);
            },
            spec,
          ),
        )
      : [];
    // Running and rerunning comparisons needs the founder's own words: never on event turns.
    const runJobTool =
      ui?.jobs && !event
        ? createJobToolExecutor(
            { ...ui, jobs: ui.jobs },
            {
              profile: () => session.snapshot().profile,
              missing: () => session.snapshot().missingRequiredFields,
              draftCity: () => session.snapshot().draft.city,
            },
          )
        : undefined;
    const jobTools = runJobTool
      ? JOB_TOOL_SPECS.filter((spec) =>
          FLOW_JOB_TOOL_NAMES.includes(spec.name),
        ).map((spec) =>
          tool(
            (args) => {
              signal.throwIfAborted();
              return runJobTool(spec.name, args);
            },
            spec,
          ),
        )
      : [];
    // A finished comparison's results ride on the event note, saving a model round trip.
    let resultsText: string | undefined;
    if (event?.kind === "comparison_finished" && runFlowTool && ui?.results) {
      const text = await runFlowTool("read_comparison_results", {
        comparisonId: event.comparisonId,
      });
      resultsText = text.startsWith("Error:")
        ? `${text} Present the results only in general terms.`
        : text;
    }
    signal.throwIfAborted();
    const agent = createDeepAgent({
      model,
      tools: [...(event ? [] : [saveProfile]), ...uiTools, ...flowTools, ...jobTools],
      systemPrompt: [
        FLOW_INSTRUCTIONS,
        event ? eventInstructions : profileInstructions,
        ...(ui ? [uiInstructions] : []),
        ...(runJobTool ? [jobInstructions] : []),
      ].join("\n"),
      // Override default tool-bearing middleware. No file or delegation capabilities
      // are needed for intake, and no checkpointer/store is configured.
      middleware: [
        { name: "FilesystemMiddleware", tools: [] },
        { name: "subAgentMiddleware", tools: [] },
      ],
      name: "founder_intake",
    });
    const tally = new UsageTally();
    const finish = (outcome: string) =>
      logTurn({
        outcome,
        saves,
        saved,
        rejectedUnknowns,
        ...(event ? { flowEvent: event.kind } : {}),
        viewContextBytes: new TextEncoder().encode(viewContextLine ?? "")
          .length,
        ...(ui ? { uiActions: ui.actions.length } : {}),
        ...tally.usage,
      });
    let result;
    try {
      result = await agent.invoke(
        {
          messages: [
            {
              role: "user",
              content: `Current validated draft:\n${JSON.stringify(intakeBrief(session.snapshot()))}${viewContextLine ? `\n${viewContextLine}` : ""}\n\n${event ? flowEventNote(event, resultsText) : `Founder says:\n${message}`}`,
            },
          ],
        },
        { recursionLimit: INTAKE_RECURSION_LIMIT, signal, callbacks: [tally] },
      );
    } catch (error) {
      // The draft keeps every save that succeeded, and `ui.actions` every queued UI action.
      // When the step budget runs out, say what happened and ask the next question rather
      // than failing the turn.
      if (error instanceof Error && error.name === "GraphRecursionError") {
        finish("tool_limit");
        // An event turn with no reply gets the handler's deterministic event reply.
        if (event) return "";
        return saved > 0
          ? `I've saved what you told me so far. ${fallbackReply()}`
          : `I couldn't process that in one go. Could you rephrase it or share it in smaller pieces? ${fallbackReply()}`;
      }
      finish("error");
      throw error;
    }
    finish("ok");
    const last = [...result.messages]
      .reverse()
      .find((entry) => entry.type === "ai" && entry.content);
    if (!last) return event ? "" : fallbackReply();
    if (typeof last.content === "string") return last.content;
    return last.content
      .flatMap((block) => (block.type === "text" ? [block.text] : []))
      .join("\n");
  };
}

/** Uses only the configured OpenAI model; never chooses a paid fallback. */
export const runConfiguredIntakeAgent: IntakeRunner = async (input) => {
  const apiKey = process.env.OPENAI_API_KEY?.trim();
  if (!apiKey) throw new Error("Intake model is not configured");
  const model = new ChatOpenAI({
    model: process.env.OPENAI_MODEL?.trim() || DEFAULT_INTAKE_MODEL,
    apiKey,
    temperature: 0,
    reasoning: { effort: "none" },
    maxTokens: 1500,
    maxRetries: 0,
    timeout: 10_000,
    configuration: modelConfiguration(process.env),
  });
  return createDeepIntakeRunner(model)(input);
};
