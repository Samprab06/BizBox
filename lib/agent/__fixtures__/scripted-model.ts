import type { AIMessage, BaseMessage } from "@langchain/core/messages";
import { BaseChatModel } from "@langchain/core/language_models/chat_models";
import type { IntakeUiLookups } from "../ui-tools";

/** A chat model that replays scripted replies; no provider, key or network. */
export class ScriptedModel extends BaseChatModel {
  boundNames: string[] = [];
  /** Messages received on each model call, in order. */
  calls: BaseMessage[][] = [];
  constructor(private readonly responses: AIMessage[]) {
    super({});
  }
  _llmType() {
    return "intake-test-model";
  }
  bindTools(tools: Parameters<NonNullable<BaseChatModel["bindTools"]>>[0]) {
    this.boundNames = tools.map((entry) =>
      "name" in entry ? String(entry.name) : "",
    );
    return this;
  }
  async _generate(messages: BaseMessage[]) {
    this.calls.push(messages);
    const message = this.responses.shift();
    if (!message) throw new Error("Unexpected extra model invocation");
    return {
      generations: [
        {
          text: typeof message.content === "string" ? message.content : "",
          message,
        },
      ],
    };
  }
}

/** In-memory trusted data for the UI tools: two Houston suites, one LA suite. */
export const UI_FIXTURE = {
  projectId: "project-1",
  montroseSiteId: "L-montrose:S-1",
  heightsSiteId: "L-heights:S-2",
  losAngelesSiteId: "L-silverlake:S-3",
  comparisonId: "cmp_own",
  foreignComparisonId: "cmp_other_project",
  investigationId: "inv_own",
};

export function fixtureUiLookups(): IntakeUiLookups & { calls: string[] } {
  const sites = new Map([
    [UI_FIXTURE.montroseSiteId, "Houston"],
    [UI_FIXTURE.heightsSiteId, "HOUSTON"],
    [UI_FIXTURE.losAngelesSiteId, "Los Angeles"],
  ]);
  const comparisons = new Map([
    [UI_FIXTURE.comparisonId, UI_FIXTURE.projectId],
    [UI_FIXTURE.foreignComparisonId, "project-2"],
  ]);
  const investigations = new Map([[UI_FIXTURE.investigationId, UI_FIXTURE.projectId]]);
  const calls: string[] = [];
  return {
    calls,
    async site(siteId) {
      calls.push(`site:${siteId}`);
      const city = sites.get(siteId);
      return city === undefined ? null : { city };
    },
    async comparisonExists(projectId, comparisonId) {
      calls.push(`cmp:${comparisonId}`);
      return comparisons.get(comparisonId) === projectId;
    },
    async investigationExists(projectId, investigationId) {
      calls.push(`inv:${investigationId}`);
      return investigations.get(investigationId) === projectId;
    },
  };
}
