import type {
  StoredThreadEvent,
  ThreadMutation,
  ThreadSnapshot,
  ThreadStore,
} from "../thread-store";

/** In-memory ThreadStore with the Postgres store's revision, replay and cost-cap rules. */
export function createMemoryThreadStore(capMicrousd = 5_000_000): ThreadStore {
  let state: ThreadSnapshot | undefined;
  const events: StoredThreadEvent[] = [];
  const commits = new Map<string, string>();
  return {
    async ensure(projectId) {
      state ??= {
        projectId,
        revision: 0,
        nextEventSeq: 1,
        messages: [],
        toolCalls: [],
        todos: [],
        turn: null,
        checkpoint: null,
        costMicrousd: 0,
        costCapMicrousd: capMicrousd,
        createdAt: new Date(0).toISOString(),
        updatedAt: new Date(0).toISOString(),
      };
      return state;
    },
    async load() {
      return state ?? null;
    },
    async commit(projectId, revision, mutation: ThreadMutation) {
      if (!state || state.revision !== revision)
        throw new Error("revision conflict");
      const old = commits.get(mutation.idempotencyKey);
      if (old) {
        if (old !== JSON.stringify(mutation))
          throw new Error("replay conflict");
        return state;
      }
      if (state.costMicrousd + (mutation.costMicrousd ?? 0) > capMicrousd)
        throw new Error("cost cap");
      commits.set(mutation.idempotencyKey, JSON.stringify(mutation));
      const upsert = <T extends { id: string }>(
        before: T[],
        after: T[] = [],
      ) => {
        const rows = new Map(before.map((row) => [row.id, row]));
        for (const row of after) rows.set(row.id, row);
        return [...rows.values()];
      };
      for (const [index, event] of (mutation.events ?? []).entries())
        events.push({
          ...event,
          projectId,
          seq: state.nextEventSeq + index,
          createdAt: new Date(0).toISOString(),
        });
      state = {
        ...state,
        revision: revision + 1,
        nextEventSeq: state.nextEventSeq + (mutation.events?.length ?? 0),
        messages: upsert(state.messages, mutation.messages),
        toolCalls: upsert(state.toolCalls, mutation.toolCalls),
        todos: mutation.todos ?? state.todos,
        turn: mutation.turn === undefined ? state.turn : mutation.turn,
        checkpoint:
          mutation.checkpoint === undefined
            ? state.checkpoint
            : mutation.checkpoint,
        costMicrousd: state.costMicrousd + (mutation.costMicrousd ?? 0),
      };
      return state;
    },
    async events(_projectId, afterSeq = 0) {
      return events.filter((event) => event.seq > afterSeq);
    },
  };
}
