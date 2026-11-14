import {
  createCopilotMutationTools,
  type CopilotMutationDependencies,
  type CopilotMutationContext,
} from "./copilot-tools";
import {
  createCopilotReadTools,
  type CopilotReadDependencies,
} from "./copilot-read-tools";
import {
  createCopilotRunTools,
  type CopilotRunDependencies,
} from "./copilot-run-tools";

/** One business-tool registry for HAC-83; no conversation or client state here. */
export function createCopilotTools(deps: {
  mutations: CopilotMutationDependencies;
  reads: CopilotReadDependencies;
  runs: CopilotRunDependencies;
}) {
  const mutations = createCopilotMutationTools(deps.mutations);
  const reads = createCopilotReadTools(deps.reads);
  const runs = createCopilotRunTools(deps.runs);
  const mutationDefinitions = mutations.definitions.filter(
    (d) => d.name !== "run_scenario",
  );
  const definitions = [
    ...mutationDefinitions,
    ...reads.definitions,
    ...runs.definitions,
  ];
  type Name = (typeof definitions)[number]["name"];
  return {
    definitions,
    async execute(name: Name, args: unknown, context: CopilotMutationContext) {
      if (name === "run_scenario") return runs.execute(name, args, context);
      if (reads.definitions.some((d) => d.name === name))
        return reads.execute(
          name as Parameters<typeof reads.execute>[0],
          args,
          context,
        );
      return mutations.execute(
        name as Parameters<typeof mutations.execute>[0],
        args,
        context,
      );
    },
  };
}
