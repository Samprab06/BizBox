import { describe, expect, it, vi } from "vitest";
import { IntakeRequestSchema } from "@/lib/contracts/intake";
import {
  initialSession,
  type IntakeSession,
} from "@/components/intake/profile";
import type { IntakeResponse } from "@/components/intake/live";
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

  it("carries saved offline onboarding answers into the first chat request without pending edits", () => {
    const offline: IntakeSession = {
      profile: {
        concept: { value: "Neighborhood coffee shop", origin: "founder" },
        category: { value: "Coffee shop", origin: "founder" },
        city: { value: "Houston", origin: "founder" },
        rent: { value: "4500", origin: "founder" },
        staff: { value: "2", origin: "founder" },
      },
      messages: initialSession.messages,
    };
    const body = intakeRequestBody(
      offline,
      "What do you know about my business?",
    );
    expect(body.patch).toMatchObject({
      concept: "Neighborhood coffee shop",
      category: "coffee",
      city: "Houston",
      economics: {
        monthlyRentCeilingCents: { value: 450000, origin: "founder" },
      },
      capacity: { servers: { value: 2, origin: "founder" } },
    });
    expect(IntakeRequestSchema.safeParse(body).success).toBe(true);
    expect(offline).not.toHaveProperty("pending");
  });

  it("sends current founder answers over a stale live draft after offline edits", () => {
    const offlineEdit: IntakeSession = {
      ...session,
      profile: { rent: { value: "3000", origin: "founder" } },
      pending: [],
      live: {
        state: { draft: reply.draft, assumptions: {} },
        missingRequiredFields: [],
        findings: [],
      },
    };
    const body = intakeRequestBody(offlineEdit, "Use my current rent limit");
    expect(body.patch).toMatchObject({
      economics: {
        monthlyRentCeilingCents: { value: 300000, origin: "founder" },
      },
    });
    expect(body.message).toBe("Use my current rent limit");
    expect(body.state).toEqual({ draft: reply.draft, assumptions: {} });
    expect(intakeRequestBody(offlineEdit).patch).toBeUndefined();
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
