import { describe, expect, it, vi } from "vitest";
import { createIntakeHandler } from "./handler";

vi.mock("server-only", () => ({}));
import { founderAnswers } from "@/lib/agent/__fixtures__/founder";
import { BusinessProfileSchema } from "@/lib/contracts";
import { AIMessage } from "@langchain/core/messages";
import { createIntakeSession } from "@/lib/agent/intake";
import {
  createDeepIntakeRunner,
  INTAKE_TIMEOUT_MS,
} from "@/lib/agent/runner";
import {
  fixtureUiLookups,
  ScriptedModel,
  UI_FIXTURE,
} from "@/lib/agent/__fixtures__/scripted-model";
import { UiActionListSchema } from "@/lib/contracts/agent";
import { createIntakeThreadRecorder } from "@/lib/agent/copilot-intake";
import type { ThreadStore } from "@/lib/agent/thread-store";

const context = (projectId = "project-1") => ({
  params: Promise.resolve({ projectId }),
});
const request = (body: unknown) =>
  new Request("http://localhost/api/projects/project-1/intake", {
    method: "POST",
    body: JSON.stringify(body),
  });

describe("POST project intake", () => {
  it("returns a schema-valid full profile through a scripted conversation runner", async () => {
    const handler = createIntakeHandler({
      projectExists: async () => true,
      runAgent: async ({ session }) => {
        for (const answer of founderAnswers) session.saveProfile(answer);
        return "Please review the default assumptions.";
      },
    });
    const response = await handler(
      request({ message: "My seven interview answers" }),
      context("authoritative-project"),
    );
    const body = await response.json();
    expect(response.status).toBe(200);
    expect(BusinessProfileSchema.parse(body.profile).projectId).toBe(
      "authoritative-project",
    );
    expect(body.missingRequiredFields).toEqual([]);
  });

  it("reports safe validation fields in the established error shape", async () => {
    const handler = createIntakeHandler({ projectExists: async () => true });
    const response = await handler(
      request({ patch: { city: "private invalid input" } }),
      context(),
    );
    const body = await response.json();
    expect(body.code).toBe("INVALID_INTAKE");
    expect(body.field_errors["patch.city"]).toEqual(["Invalid intake value"]);
    expect(JSON.stringify(body)).not.toContain("private invalid input");
  });

  it("does not invoke a runner for an already-aborted request", async () => {
    const controller = new AbortController();
    controller.abort();
    const runAgent = vi.fn(async () => new Promise<string>(() => {}));
    const handler = createIntakeHandler({
      projectExists: async () => true,
      runAgent,
    });
    const req = new Request("http://localhost", {
      method: "POST",
      body: JSON.stringify({ message: "Coffee" }),
      signal: controller.signal,
    });
    expect((await handler(req, context())).status).toBe(503);
    expect(runAgent).not.toHaveBeenCalled();
  });

  it("bounds a runner that does not respond to cancellation", async () => {
    vi.useFakeTimers();
    try {
      const runAgent = vi.fn(async () => new Promise<string>(() => {}));
      const handler = createIntakeHandler({
        projectExists: async () => true,
        runAgent,
      });
      const response = handler(request({ message: "Coffee" }), context());
      // Let request parsing and project lookup finish before advancing the deadline.
      await vi.waitFor(() => expect(runAgent).toHaveBeenCalled());
      await vi.advanceTimersByTimeAsync(INTAKE_TIMEOUT_MS);
      expect((await response).status).toBe(503);
    } finally {
      vi.useRealTimers();
    }
  });

  it("returns a partial stateless interview and lets the caller round trip it", async () => {
    const handler = createIntakeHandler({ projectExists: async () => true });
    const response = await handler(
      request({ patch: { businessName: "Morning Cup", category: "coffee" } }),
      context(),
    );
    expect(response.status).toBe(200);
    expect(response.headers.get("Cache-Control")).toBe("no-store");
    const body = await response.json();
    expect(body.profile).toBeNull();
    expect(body.persisted).toBe(false);
    const followup = await handler(
      request({
        state: { draft: body.draft, assumptions: body.assumptions },
        patch: { city: "Los Angeles" },
      }),
      context(),
    );
    expect((await followup.json()).draft.city).toBe("Los Angeles");
  });

  it("binds injected conversation runners to the path project", async () => {
    const handler = createIntakeHandler({
      projectExists: async (id) => id === "from-path",
      runAgent: async ({ session }) => {
        session.saveProfile({ concept: "Coffee" });
        return "Which city?";
      },
    });
    const response = await handler(
      request({ message: "Coffee please" }),
      context("from-path"),
    );
    const body = await response.json();
    expect(response.status).toBe(200);
    expect(body.draft.concept).toBe("Coffee");
    expect(body.assistantMessage).toBe("Which city?");
    expect(body.persisted).toBe(false);
  });

  it.each([
    { projectId: "body-project" },
    { patch: { projectId: "body-project" } },
    { patch: { city: "Boston" } },
    { patch: { economics: { extra: 3 } } },
    { message: "" },
    [],
  ])("rejects malformed and identity-changing requests: %j", async (body) => {
    const projectExists = vi.fn(async () => true);
    const handler = createIntakeHandler({ projectExists });
    const response = await handler(request(body), context());
    expect(response.status).toBe(422);
    expect(projectExists).not.toHaveBeenCalled();
  });

  it("returns 422 for malformed JSON and oversized bodies", async () => {
    const handler = createIntakeHandler({ projectExists: async () => true });
    for (const body of [
      "{broken",
      JSON.stringify({ message: "x".repeat(70_000) }),
    ]) {
      const response = await handler(
        new Request("http://localhost", { method: "POST", body }),
        context(),
      );
      expect(response.status).toBe(422);
    }
  });

  it("returns 404 for unknown projects", async () => {
    const handler = createIntakeHandler({ projectExists: async () => false });
    expect((await handler(request({}), context())).status).toBe(404);
  });

  it("sanitizes database and provider failures", async () => {
    const secret = "PRIVATE_PROVIDER_KEY";
    for (const dependencies of [
      {
        projectExists: async () => {
          throw new Error(secret);
        },
      },
      {
        projectExists: async () => true,
        runAgent: async () => {
          throw new Error(secret);
        },
      },
    ]) {
      const handler = createIntakeHandler(dependencies);
      const response = await handler(request({ message: "Coffee" }), context());
      expect(response.status).toBe(503);
      expect(await response.text()).not.toContain(secret);
    }
  });

  it("returns 503 when no conversation model is configured", async () => {
    vi.stubEnv("OPENAI_API_KEY", "");
    try {
      const handler = createIntakeHandler({ projectExists: async () => true });
      expect(
        (await handler(request({ message: "Coffee" }), context())).status,
      ).toBe(503);
    } finally {
      vi.unstubAllEnvs();
    }
  });
  it("still returns its normal 200 when the copilot thread store throws", async () => {
    const runAgent = async ({
      session,
    }: Parameters<
      NonNullable<Parameters<typeof createIntakeHandler>[0]["runAgent"]>
    >[0]) => {
      session.saveProfile(founderAnswers[0]!);
      return "Tell me about rent.";
    };
    const missingTable = Object.assign(
      new Error('relation "copilot_threads" does not exist: I want a cafe'),
      { code: "42P01" },
    );
    const store = {
      ensure: vi.fn(async () => {
        throw missingTable;
      }),
      commit: vi.fn(async () => {
        throw missingTable;
      }),
    } as unknown as ThreadStore;
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    try {
      const baseline = await createIntakeHandler({
        projectExists: async () => true,
        runAgent,
      })(request({ message: "I want a cafe" }), context());
      for (const onCompleted of [
        createIntakeThreadRecorder(store),
        async () => {
          throw new Error("write failed: I want a cafe");
        },
      ]) {
        const response = await createIntakeHandler({
          projectExists: async () => true,
          runAgent,
          onCompleted,
        })(request({ message: "I want a cafe" }), context());
        expect(response.status).toBe(200);
        expect(await response.json()).toEqual(await baseline.clone().json());
      }
      expect(store.ensure).toHaveBeenCalledTimes(1);
      expect(warn).toHaveBeenCalledTimes(2);
      for (const [line] of warn.mock.calls) {
        expect(String(line)).not.toContain("cafe");
        expect(String(line)).not.toContain("\n");
      }
      expect(String(warn.mock.calls[0]?.[0])).toContain("42P01");
    } finally {
      warn.mockRestore();
    }
  });
});

describe("HAC-144 intake UI actions", () => {
  const uiHandler = (model: ScriptedModel) => {
    let n = 0;
    return createIntakeHandler({
      projectExists: async () => true,
      runAgent: createDeepIntakeRunner(model),
      uiLookups: fixtureUiLookups(),
      newActionId: () => `ui_${++n}`,
    });
  };
  const houstonState = () => {
    const session = createIntakeSession(UI_FIXTURE.projectId);
    session.saveProfile({ city: "Houston" });
    const { draft, assumptions } = session.snapshot();
    return { draft, assumptions };
  };

  it("returns { ...snapshot, assistantMessage, actions } for a scripted Montrose request", async () => {
    const model = new ScriptedModel([
      new AIMessage({
        content: "",
        tool_calls: [
          { id: "1", name: "show_step", args: { stage: "map" } },
          {
            id: "2",
            name: "open_site",
            args: { siteId: UI_FIXTURE.montroseSiteId },
          },
        ],
      }),
      new AIMessage("Here are the Montrose spaces."),
    ]);
    const response = await uiHandler(model)(
      request({
        state: houstonState(),
        message: "show me spaces in Montrose",
        view: {
          stage: "workspace",
          candidateIds: [UI_FIXTURE.montroseSiteId],
        },
      }),
      context(UI_FIXTURE.projectId),
    );
    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.assistantMessage).toBe("Here are the Montrose spaces.");
    expect(body.draft.city).toBe("Houston");
    expect(UiActionListSchema.parse(body.actions)).toEqual([
      { id: "ui_1", type: "navigate", stage: "map" },
      { id: "ui_2", type: "open_site", siteId: UI_FIXTURE.montroseSiteId },
    ]);
  });

  it("rejects a spoofed site ID and a comparison from another project server-side", async () => {
    const model = new ScriptedModel([
      new AIMessage({
        content: "",
        tool_calls: [
          { id: "1", name: "open_site", args: { siteId: "L-spoof:S-1" } },
          {
            id: "2",
            name: "show_plan",
            args: { comparisonId: UI_FIXTURE.foreignComparisonId },
          },
        ],
      }),
      new AIMessage("I couldn't open those."),
    ]);
    const response = await uiHandler(model)(
      request({
        message: "open my plan",
        view: { stage: "workspace", siteId: "L-spoof:S-1" },
      }),
      context(UI_FIXTURE.projectId),
    );
    const body = await response.json();
    expect(response.status).toBe(200);
    expect(body.actions).toEqual([]);
  });

  it("returns the actions collected so far when the step budget runs out", async () => {
    const targets = ["map", "candidate_list", "site_summary"];
    const model = new ScriptedModel(
      Array.from({ length: 20 }, (_, index) =>
        new AIMessage({
          content: "",
          tool_calls: [
            {
              id: `h-${index}`,
              name: "highlight",
              args: { target: targets[index % 3] },
            },
          ],
        }),
      ),
    );
    const response = await uiHandler(model)(
      request({ message: "point at things" }),
      context(UI_FIXTURE.projectId),
    );
    const body = await response.json();
    expect(response.status).toBe(200);
    expect(body.assistantMessage).toContain("couldn't process that");
    expect(body.actions.map((a: { target: string }) => a.target)).toEqual(
      targets,
    );
  });

  it("without a model, the patch that completes the profile shows the spaces step", async () => {
    let n = 0;
    const handler = createIntakeHandler({
      projectExists: async () => true,
      newActionId: () => `ui_${++n}`,
    });
    const session = createIntakeSession("project-1");
    for (const answer of founderAnswers.slice(0, -1)) session.saveProfile(answer);
    const { draft, assumptions } = session.snapshot();
    const completing = await (
      await handler(
        request({ state: { draft, assumptions }, patch: founderAnswers.at(-1) }),
        context(),
      )
    ).json();
    expect(completing.profile).not.toBeNull();
    expect(completing.actions).toEqual([
      { id: "ui_1", type: "navigate", stage: "map" },
    ]);
    // A later form sync of the already-complete profile does not navigate again.
    const again = await (
      await handler(
        request({
          state: { draft: completing.draft, assumptions: completing.assumptions },
        }),
        context(),
      )
    ).json();
    expect(again.actions).toEqual([]);
  });
});
