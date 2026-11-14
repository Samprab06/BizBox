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
});
