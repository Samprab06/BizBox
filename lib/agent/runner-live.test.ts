import { describe, expect, it, vi } from "vitest";
import { createIntakeSession } from "./intake";
import { runConfiguredIntakeAgent } from "./runner";

vi.mock("server-only", () => ({}));

// A key alone never opts a routine test/build into a paid provider request.
const enabled =
  process.env.RUN_OPENAI_LIVE === "1" && !!process.env.OPENAI_API_KEY?.trim();
describe("OpenAI intake [live]", () => {
  it.skipIf(!enabled)(
    "completes one synthetic intake turn through deepagents",
    async () => {
      const session = createIntakeSession("synthetic-live-intake");
      const reply = await runConfiguredIntakeAgent({
        session,
        message:
          "This is a synthetic test. Save businessName Test Cup, category coffee, and concept neighborhood coffee counter using save_profile, then ask the next missing question.",
        signal: AbortSignal.timeout(20_000),
      });
      expect(reply.trim()).not.toBe("");
      expect(session.snapshot().draft.category).toBe("coffee");
    },
    25_000,
  );
});
