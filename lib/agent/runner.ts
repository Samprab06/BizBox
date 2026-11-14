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
/** Graph step budget for one intake turn. A normal turn is one save and a reply (about 4 steps). */
export const INTAKE_RECURSION_LIMIT = 12;
/** One save_profile call per turn is normal; a second covers a rejected or corrected patch. */
export const INTAKE_MAX_SAVES = 2;
import type { IntakeRunner } from "./runtime-loader";
export { INTAKE_TIMEOUT_MS, type IntakeRunner } from "./runtime-loader";

const instructions = `You are the founder-facing intake agent for a Houston / Los Angeles service-location investigation.
Question groups, asked one at a time where information is missing:
${INTAKE_QUESTIONS.map((group) => `- ${group.question}`).join("\n")}
Each turn: call save_profile ONCE with everything the founder just said, then reply with a short acknowledgement and the returned nextQuestion. Do not call it again to verify; its result lists what is saved and what is missing. The draft in the message is already validated.
Never invent names, objectives, cities, staff, hours, customers, budgets or must-haves. Leave anything the founder did not address out of the patch: it stays undefined and is asked about later.
"Unknown" (value null with unknownReason) needs the founder's own words, such as "I don't know my rent budget yet". A field the founder did not mention is NOT unknown. Never write an unknown for a topic they did not address; the tool drops those. Do not block the interview on unknown answers.
Entries are {value,unit,unknownReason?}; origin is added for you. Money is USD cents; times are integer minutes since midnight, closing after opening the same day. Supported categories: coffee, quick_food, salon_barber, fitness; save any other category verbatim.
Category defaults (service, travel, patience, visits, peak hours, wage, COGS, floor area) are illustrative assumptions, not calibrated observations or forecasts: call them defaults and invite review. Founder statements override any default; service time goes under capacity, wage/COGS/travel/patience under derivedDefaults, visits/peak/area under assumptions.
If only average ticket or price tier is known, ask about the other. Do not change origins, research sources, access files, delegate, or call other services.`;

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
  return async ({ session, message, signal }) => {
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
    const agent = createDeepAgent({
      model,
      tools: [saveProfile],
      systemPrompt: instructions,
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
      logTurn({ outcome, saves, saved, rejectedUnknowns, ...tally.usage });
    let result;
    try {
      result = await agent.invoke(
        {
          messages: [
            {
              role: "user",
              content: `Current validated draft:\n${JSON.stringify(intakeBrief(session.snapshot()))}\n\nFounder says:\n${message}`,
            },
          ],
        },
        { recursionLimit: INTAKE_RECURSION_LIMIT, signal, callbacks: [tally] },
      );
    } catch (error) {
      // The draft keeps every save that succeeded. When the step budget runs out, say what
      // happened and ask the next question rather than failing the turn.
      if (error instanceof Error && error.name === "GraphRecursionError") {
        finish("tool_limit");
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
    if (!last) return fallbackReply();
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
