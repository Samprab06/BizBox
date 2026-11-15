import "server-only";
import { createHash } from "node:crypto";
import { z } from "zod";
import type { IntakeRequestSchema } from "@/lib/contracts/intake";
import {
  createPostgresThreadStore,
  ThreadStoreError,
  type ThreadStore,
  type ThreadMutation,
  type StoredMessage,
} from "./thread-store";

type IntakeInput = z.infer<typeof IntakeRequestSchema>;

/** Intake is the first phase of this project thread, not a second agent history.
 * Keep the validated draft as an internal attachment; do not emit it as prose. */
export function createIntakeThreadRecorder(
  store: ThreadStore = createPostgresThreadStore(),
) {
  return async (
    projectId: string,
    input: IntakeInput,
    assistantMessage: string,
    draft: unknown,
  ) => {
    if (!input.message && !input.patch) return;
    const value = z.json().parse(JSON.parse(JSON.stringify({ input, draft })));
    const hash = createHash("sha256")
      .update(JSON.stringify({ projectId, value }))
      .digest("hex");
    const key = `intake:${hash}`;
    const messages: StoredMessage[] = [];
    if (input.message)
      messages.push({
        id: `${key}:user`,
        role: "user",
        content: input.message,
        metadata: { phase: "intake" },
      });
    messages.push({
      id: `${key}:assistant`,
      role: "assistant",
      content: assistantMessage,
      metadata: { phase: "intake", validatedDraft: value },
    });
    const mutation: ThreadMutation = {
      idempotencyKey: key,
      messages,
      events: [
        {
          type: "intake_completed",
          payload: { phase: "intake", messageId: `${key}:assistant` },
        },
      ],
    };
    for (let attempt = 0; attempt < 3; attempt++) {
      const state = await store.ensure(projectId);
      try {
        await store.commit(projectId, state.revision, mutation);
        return;
      } catch (error) {
        if (
          !(error instanceof ThreadStoreError) ||
          error.code !== "conflict" ||
          attempt === 2
        )
          throw error;
      }
    }
  };
}
