import "server-only";
import { ChatOpenAI } from "@langchain/openai";
import { tool } from "@langchain/core/tools";
import { createDeepAgent, type CreateDeepAgentParams } from "deepagents";
import { IntakePatchSchema } from "@/lib/contracts/intake";
import { INTAKE_QUESTIONS } from "./intake";
import type { IntakeRunner } from "./runtime-loader";
export { INTAKE_TIMEOUT_MS, type IntakeRunner } from "./runtime-loader";

export const DEFAULT_INTAKE_MODEL = "gpt-6-luna";
/** OpenAI-compatible gateway URL; unset means the native OpenAI endpoint. */
export function modelConfiguration(env: Record<string, string | undefined>) {
  const baseURL = env.OPENAI_BASE_URL?.trim();
  return {
    timeout: 10_000,
    maxRetries: 0,
    ...(baseURL ? { baseURL } : {}),
  };
}
/** Graph step budget for one intake turn: up to 3 save_profile calls plus the reply. */
export const INTAKE_RECURSION_LIMIT = 12;

const instructions = `You are the founder-facing intake (FDE) agent for a Houston / Los Angeles service-location investigation.
Ask these seven groups, one at a time where information is missing: ${INTAKE_QUESTIONS.map((group) => group.question).join("\n")}
Use save_profile to record the founder's answers. It updates only the current stateless draft, not durable storage.
Inspect the returned profile, missingRequiredFields and findings. Never claim the profile is complete unless profile is non-null.
Do not invent business names, objectives, cities, staff, hours, target customers, budgets or must-haves to satisfy required fields.
A founder may explicitly say unknown: use a null value and unknownReason, not zero; do not block the interview on unknown information.
Numeric/boolean/price-tier entries use {value,unit,origin:'founder',evidenceIds:['founder-answer'],unknownReason?}. Money is USD cents; time offsets are integer minutes since midnight, closing after opening in the same modeled day.
Supported categories: coffee, quick_food, salon_barber, fitness. Save any other category verbatim; the tool marks it unsupported.
The tool proposes category defaults for serviceMinutes, travelMinutes, visitsPerMonth, peakHourProfile, wageRateCentsPerHour, cogsFraction, squareFeetPerStation, minimumFrontOfHouseSqFt and patienceMinutes.
These are illustrative assumptions, not calibrated observations or sales forecasts. Clearly call them defaults and invite review.
Founder statements override ANY default. Record service duration under capacity, wage/COGS/travel/patience under derivedDefaults, and visits/peak/station area/minFOH under assumptions.
If only average ticket or price tier is known, ask about the other; record an explicit unknown only when the founder says it is unknown. Ask about startup/monthly operating budgets too; unknown is acceptable.
Do not change origins to public or costar, research external sources, access files, delegate, or call other services. Missing information becomes findings and follow-up questions.`;

export function createDeepIntakeRunner(
  model: NonNullable<CreateDeepAgentParams["model"]>,
): IntakeRunner {
  return async ({ session, message, signal }) => {
    let saves = 0;
    const saveProfile = tool(
      (patch) => {
        if (++saves > 3) throw new Error("Intake tool call limit exceeded");
        signal.throwIfAborted();
        return JSON.stringify(session.saveProfile(patch));
      },
      {
        name: "save_profile",
        description:
          "Validate and merge founder answers into this interview draft. Returns canonical BusinessProfile or null, missing fields, default provenance, findings, and the next question. Does not write durable storage.",
        schema: IntakePatchSchema,
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
    let result;
    try {
      result = await agent.invoke(
        {
          messages: [
            {
              role: "user",
              content: `Current validated draft:\n${JSON.stringify(session.snapshot())}\n\nFounder says:\n${message}`,
            },
          ],
        },
        // Each tool call takes two graph steps; three saves plus a reply need ~8 (HAC-58).
        { recursionLimit: INTAKE_RECURSION_LIMIT, signal },
      );
    } catch (error) {
      // The draft keeps every save that succeeded; answer with the next question
      // instead of failing the turn when the step budget runs out.
      if (
        saves > 0 &&
        error instanceof Error &&
        error.name === "GraphRecursionError"
      )
        return (
          session.snapshot().nextQuestion?.question ??
          "Your answers have been recorded in this draft. Review the findings and defaults."
        );
      throw error;
    }
    const last = [...result.messages]
      .reverse()
      .find((entry) => entry.type === "ai" && entry.content);
    if (!last)
      return (
        session.snapshot().nextQuestion?.question ??
        "Your answers have been recorded in this draft. Review the findings and defaults."
      );
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
