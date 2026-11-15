import { describe, expect, it, vi } from "vitest";
import { IntakeRequestSchema } from "@/lib/contracts/intake";
import {
  initialSession,
  type IntakeSession,
} from "@/components/intake/profile";
import { patchFromForm, type IntakeResponse } from "@/components/intake/live";
import {
  applyIntakeReply,
  intakeRequestBody,
  intakeStorageKey,
  parseIntakeSession,
  postIntakeMessage,
  sessionOrInitial,
  withFounderMessage,
} from "./intake-conversation";

const reply = {
  draft: {
    category: "coffee",
    city: "Houston",
    concept: "Neighborhood coffee bar",
  },
  assumptions: {},
  missingRequiredFields: ["businessName"],
  findings: [],
  nextQuestion: null,
  assistantMessage: "Parking is limited near Montrose.",
} satisfies IntakeResponse;

const session: IntakeSession = {
  profile: { rent: { value: "4500", origin: "founder" } },
  messages: [{ role: "agent", text: "Hello" }],
  pending: ["rent"],
};

describe("workspace assistant uses the existing intake session and endpoint", () => {
  it("reads the intake screen's storage key and tolerates missing or damaged sessions", () => {
    expect(intakeStorageKey("houston-coffee")).toBe(
      "sitework:intake:v1:houston-coffee",
    );
    expect(parseIntakeSession(null)).toBeNull();
    expect(parseIntakeSession("{not json")).toBeNull();
    expect(parseIntakeSession(JSON.stringify(session))).toEqual(session);
    expect(sessionOrInitial(null)).toBe(initialSession);
  });

  it("sends the same body shape as the intake screen, accepted by the API contract", () => {
    const body = intakeRequestBody(session, "Is parking nearby?");
    expect(body.message).toBe("Is parking nearby?");
    expect(body.patch).toMatchObject({
      economics: { monthlyRentCeilingCents: { value: 450000 } },
    });
    expect(
      IntakeRequestSchema.safeParse(JSON.parse(JSON.stringify(body))).success,
    ).toBe(true);
  });

  it("posts to /api/projects/[projectId]/intake and returns the real reply", async () => {
    const fetchImpl = vi.fn(async () => Response.json(reply));
    const outcome = await postIntakeMessage(
      fetchImpl as unknown as typeof fetch,
      "houston coffee",
      intakeRequestBody(session, "Hi"),
    );
    expect(outcome).toEqual({ ok: true, result: reply });
    const [url, init] = fetchImpl.mock.calls[0] as unknown as [
      string,
      RequestInit,
    ];
    expect(url).toBe("/api/projects/houston%20coffee/intake");
    expect(init.method).toBe("POST");
    expect(JSON.parse(String(init.body)).message).toBe("Hi");
  });

  it("HAC-144: passes the reply's UI actions through and drops a list it cannot read", async () => {
    const actions = [{ id: "ui_1", type: "navigate", stage: "map" }];
    const post = (body: unknown) =>
      postIntakeMessage(
        (async () => Response.json(body)) as unknown as typeof fetch,
        "p",
        intakeRequestBody(session, "Show me spaces", {
          stage: "workspace",
          candidateIds: ["L-1:S-1"],
        }),
      );
    expect(await post({ ...reply, actions })).toEqual({
      ok: true,
      result: { ...reply, actions },
    });
    const newer = await post({
      ...reply,
      actions: [{ id: "x", type: "teleport" }],
    });
    expect(newer.ok && newer.result.actions).toBeUndefined();
    expect(newer.ok && newer.result.assistantMessage).toBe(
      reply.assistantMessage,
    );
    // The view rides on the request and the API contract accepts it.
    const body = intakeRequestBody(session, "Hi", { stage: "map" });
    expect(IntakeRequestSchema.parse(body).view).toEqual({ stage: "map" });
    expect("view" in intakeRequestBody(session, "Hi")).toBe(false);
  });

  it("reports failures; only server errors and network failures are retryable", async () => {
    const fail = (status: number, body: unknown) =>
      postIntakeMessage(
        (async () =>
          Response.json(body, { status })) as unknown as typeof fetch,
        "p",
        intakeRequestBody(session, "Hi"),
      );
    expect(await fail(503, { message: "Model unavailable." })).toEqual({
      ok: false,
      message: "Model unavailable.",
      retryable: true,
    });
    expect(await fail(422, {})).toMatchObject({ ok: false, retryable: false });
    expect(await fail(200, { nope: true })).toMatchObject({
      ok: false,
      retryable: true,
    });
    const offline = await postIntakeMessage(
      (async () => {
        throw new TypeError("offline");
      }) as unknown as typeof fetch,
      "p",
      intakeRequestBody(session, "Hi"),
    );
    expect(offline).toMatchObject({ ok: false, retryable: true });
  });

  it("appends the reply and keeps edits made while the request was in flight", () => {
    const sent = session;
    const now: IntakeSession = {
      ...withFounderMessage(sent, "Is parking nearby?"),
      profile: {
        ...sent.profile,
        concept: { value: "Edited meanwhile", origin: "founder" },
      },
      pending: ["rent", "concept"],
    };
    const next = applyIntakeReply(now, sent, reply);
    expect(next.messages.map((m) => m.text)).toEqual([
      "Hello",
      "Is parking nearby?",
      "Parking is limited near Montrose.",
    ]);
    expect(next.pending).toEqual(["concept"]);
    expect(next.profile.concept?.value).toBe("Edited meanwhile");
    expect(next.profile.city?.value).toBe("Houston");
    expect(next.live?.missingRequiredFields).toEqual(["businessName"]);
  });

  it("is the one implementation: a form sync sends no message and adds no chat reply", () => {
    const body = intakeRequestBody(session);
    expect(body.message).toBeUndefined();
    expect(body.patch).toBeDefined();
    const next = applyIntakeReply(session, session, reply, false);
    expect(next.messages).toEqual(session.messages);
    expect(next.live?.missingRequiredFields).toEqual(["businessName"]);
  });

  it("takes each surface's own wording for failures", async () => {
    const copy = {
      unreachable: "unreachable",
      unavailable: "unavailable",
      unexpected: "unexpected",
    };
    const fail = (impl: () => Promise<Response>) =>
      postIntakeMessage(
        impl as unknown as typeof fetch,
        "p",
        intakeRequestBody(session, "Hi"),
        copy,
      );
    expect(
      await fail(async () => {
        throw new TypeError("offline");
      }),
    ).toMatchObject({ message: "unreachable" });
    expect(await fail(async () => Response.json({}, { status: 500 }))).toEqual({
      ok: false,
      message: "unavailable",
      retryable: true,
    });
    expect(await fail(async () => Response.json({ nope: 1 }))).toMatchObject({
      message: "unexpected",
    });
  });
});

it("serializes the same validated-shape view with the shared text/voice body", () => {
  const view = { stage: "site", siteId: "screen" } as const;
  const body = intakeRequestBody(session, "Compare this one", view);
  expect(
    IntakeRequestSchema.parse(JSON.parse(JSON.stringify(body))).view,
  ).toEqual(view);
});

it("seeds only missing API draft leaves from the completed browser search form", async () => {
  const { fields } = await import("@/components/intake/profile");
  const values = {
    concept: "Coffee for commuters",
    category: "Coffee shop",
    city: "Houston",
    areas: "Favor Montrose",
    rent: "4000",
    buildout: "80000",
    price: "Midrange",
    customers: "Commuters",
    hours: "7am–5pm",
    staff: "2",
    requirements: "none",
  };
  const browser: IntakeSession = {
    profile: Object.fromEntries(
      fields.map(({ key }) => [key, { value: values[key], origin: "founder" }]),
    ),
    messages: [],
    live: {
      missingRequiredFields: [],
      findings: [],
      state: {
        draft: {
          businessName: "Actual business",
          economics: {
            startupBudgetCents: {
              value: null,
              unit: "USD cents",
              origin: "founder",
              evidenceIds: ["stated-unknown"],
              unknownReason: "I do not know",
            },
          },
        },
        assumptions: {},
      },
    },
  };
  const body = intakeRequestBody(
    browser,
    "this one",
    { stage: "workspace", siteId: "screen" },
    "houston-coffee",
  );
  const parsed = IntakeRequestSchema.parse(body);
  expect(parsed.state?.draft.businessName).toBe("Actual business");
  expect(parsed.state?.draft.economics?.startupBudgetCents).toEqual(
    browser.live?.state.draft.economics?.startupBudgetCents,
  );
  expect(parsed.state?.draft.economics?.averageTicketCents).toMatchObject({
    value: null,
    origin: "default",
  });
  expect(parsed.state?.draft.capacity?.serviceMinutes?.origin).toBe("default");
  expect(parsed.state?.draft.capacity?.servers?.origin).toBe("founder");
  expect(
    intakeRequestBody(
      browser,
      undefined,
      { stage: "workspace", siteId: "screen" },
      "houston-coffee",
    ).state,
  ).toEqual(browser.live?.state);
});

it("keeps the valid original draft if filling a partial constraint would conflict with the form", async () => {
  const { fields } = await import("@/components/intake/profile");
  const values = {
    concept: "Coffee",
    category: "Coffee shop",
    city: "Houston",
    areas: "Any",
    rent: "4000",
    buildout: "80000",
    price: "Midrange",
    customers: "Commuters",
    hours: "7am–5pm",
    staff: "2",
    requirements: "none",
  };
  const browser: IntakeSession = {
    profile: Object.fromEntries(
      fields.map(({ key }) => [key, { value: values[key], origin: "founder" }]),
    ),
    messages: [],
    live: {
      state: {
        draft: { operatingHours: { openMinute: 1080 } },
        assumptions: {},
      },
      missingRequiredFields: [],
      findings: [],
    },
  };
  const body = intakeRequestBody(
    browser,
    "Compare this one",
    { stage: "workspace", siteId: "screen" },
    "houston-coffee",
  );
  expect(body.state).toEqual(browser.live?.state);
  expect(IntakeRequestSchema.safeParse(body).success).toBe(true);
  const { createIntakeHandler } =
    await import("@/app/api/projects/[projectId]/intake/handler");
  const handler = createIntakeHandler({
    projectExists: async () => true,
    viewContextLookups: {
      comparison: async () => null,
      scenario: async () => null,
      investigation: async () => null,
      candidates: async () => null,
    },
    runAgent: async ({ viewContextLine }) =>
      viewContextLine?.includes('"phase":"missing"')
        ? "Continue the conversation"
        : "Unexpected selection",
  });
  const response = await handler(
    new Request("http://localhost/intake", {
      method: "POST",
      body: JSON.stringify(body),
    }),
    { params: Promise.resolve({ projectId: "houston-coffee" }) },
  );
  expect(response.status).toBe(200);
  expect((await response.json()).assistantMessage).toBe(
    "Continue the conversation",
  );
});

describe("HAC-168 founder requirements survive flags-only replies", () => {
  const text =
    "Street frontage and a dedicated drive-up or street parking for 6 cars";
  const requirements = { value: text, origin: "founder" as const };
  const flags = patchFromForm({ requirements }, ["requirements"])!
    .mustHaves as NonNullable<IntakeResponse["draft"]["mustHaves"]>;
  const result = { ...reply, draft: { ...reply.draft, mustHaves: flags } };
  const saved: IntakeSession = {
    ...session,
    profile: { requirements },
    pending: ["requirements"],
  };

  it("keeps the original numbered sentence and origin after a guided/form sync and reload", () => {
    const next = applyIntakeReply(saved, saved, result, false);
    expect(next.profile.requirements).toEqual(requirements);
    expect(next.pending).toEqual([]);
    expect(
      parseIntakeSession(JSON.stringify(next))?.profile.requirements,
    ).toEqual(requirements);
    expect(next.live?.state.draft.mustHaves).toMatchObject({
      frontage: { value: true },
      parking: { value: true },
    });
  });

  it("keeps wording through an unrelated chat reply with unchanged feature values", () => {
    const settled = {
      ...saved,
      pending: [],
      live: {
        state: { draft: result.draft, assumptions: {} },
        missingRequiredFields: [],
        findings: [],
      },
    };
    const next = applyIntakeReply(
      withFounderMessage(settled, "What about rent?"),
      settled,
      result,
    );
    expect(next.profile.requirements).toEqual(requirements);
  });

  it("still applies later chat-driven requirement changes", () => {
    const settled = {
      ...saved,
      pending: [],
      live: {
        state: { draft: result.draft, assumptions: {} },
        missingRequiredFields: [],
        findings: [],
      },
    };
    const changed = {
      ...result,
      draft: {
        ...result.draft,
        mustHaves: { ...flags, parking: { ...flags.parking!, value: false } },
      },
    };
    const next = applyIntakeReply(
      withFounderMessage(settled, "Parking is no longer needed"),
      settled,
      changed,
    );
    expect(next.profile.requirements?.value).toBe("frontage");
    expect(next.live?.state.draft.mustHaves?.parking?.value).toBe(false);
  });

  it("keeps newer requirements edited while the previous sync was in flight", () => {
    const newer = { value: "Parking for 12 cars", origin: "founder" as const };
    const next = applyIntakeReply(
      { ...saved, profile: { requirements: newer } },
      saved,
      result,
      false,
    );
    expect(next.profile.requirements).toEqual(newer);
    expect(next.pending).toContain("requirements");
  });
});
