import { describe, expect, it } from "vitest";
import {
  initialSession,
  type IntakeSession,
} from "@/components/intake/profile";
import { assistantPresentation } from "./assistant-presentation";

const session = (): IntakeSession => ({
  profile: Object.fromEntries(
    Object.entries({
      concept: "Invented coffee concept",
      category: "Coffee shop",
      city: "Houston",
      areas: "West side",
      rent: "4500",
      buildout: "80000",
      price: "Midrange",
      customers: "Commuters",
      hours: "7am–5pm",
      staff: "2",
      requirements: "None",
    }).map(([key, value]) => [key, { value, origin: "founder" }]),
  ),
  messages: structuredClone(initialSession.messages),
});
describe("workspace conversation presentation", () => {
  it("suppresses only the obsolete initial opener after a valid completed brief, without mutating history", () => {
    const saved = session();
    const original = structuredClone(saved);
    const result = assistantPresentation(saved, saved.messages);
    expect(result.messages).toEqual([]);
    expect(result.context).toBe("Coffee shop · Houston · Rent limit $4,500/mo");
    expect(result.placeholder).toBe("Ask about your saved brief…");
    expect(saved).toEqual(original);
  });
  it("preserves real founder/agent turns and later identical text", () => {
    const saved = session();
    saved.messages.push(
      { role: "founder", text: "Keep my question" },
      { role: "agent", text: "Keep this actual response" },
      initialSession.messages[0],
    );
    expect(assistantPresentation(saved, saved.messages).messages).toEqual(
      saved.messages.slice(1),
    );
    saved.messages[0] = {
      role: "founder",
      text: initialSession.messages[0].text,
    };
    expect(assistantPresentation(saved, saved.messages).messages).toEqual(
      saved.messages,
    );
  });
  it("does not hide intake guidance for missing or invalid briefs, or unrelated opening messages", () => {
    expect(
      assistantPresentation(initialSession, initialSession.messages).messages,
    ).toBe(initialSession.messages);
    const saved = session();
    saved.profile.rent!.value = "invalid";
    expect(assistantPresentation(saved, saved.messages).messages).toBe(
      saved.messages,
    );
    expect(assistantPresentation(null, []).context).toBeNull();
    const other = session();
    other.messages = [{ role: "agent", text: "A real saved answer" }];
    expect(assistantPresentation(other, other.messages).messages).toEqual(
      other.messages,
    );
  });
});
