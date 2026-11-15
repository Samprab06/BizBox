import { describe, expect, it, vi } from "vitest";
import { createScenarioApi, orderScenarioTree } from "./scenario-api";

const scenario = (id: string, parentId: string | null, createdAt: string) => ({
  id,
  parentId,
  label: id,
  author: "agent" as const,
  createdAt,
});

describe("scenario api", () => {
  it("reverts through the existing revert-to route as a founder action", async () => {
    const fetcher = vi.fn(async () =>
      Response.json({ scenario: { id: "s3" } }, { status: 201 }),
    );
    const api = createScenarioApi(fetcher as unknown as typeof fetch);
    await expect(
      api.revert({ projectId: "p 1", scenarioId: "s2", targetId: "s1" }),
    ).resolves.toEqual({ id: "s3" });
    const [url, init] = fetcher.mock.calls[0] as unknown as [
      string,
      RequestInit,
    ];
    expect(url).toBe("/api/projects/p%201/scenarios/s2/revert-to");
    expect(init.method).toBe("POST");
    expect(JSON.parse(String(init.body))).toMatchObject({
      targetId: "s1",
      author: "founder",
    });
  });

  it("surfaces the server's message on failure", async () => {
    const api = createScenarioApi((async () =>
      Response.json(
        { code: "SCENARIO_UNAVAILABLE", message: "Try later." },
        { status: 503 },
      )) as unknown as typeof fetch);
    await expect(
      api.revert({ projectId: "p", scenarioId: "s2", targetId: "s1" }),
    ).rejects.toMatchObject({ message: "Try later.", status: 503 });
    await expect(api.list("p")).rejects.toMatchObject({ status: 503 });
  });

  it("lists the scenario tree", async () => {
    const api = createScenarioApi((async () =>
      Response.json({
        tree: [{ scenario: scenario("a", null, "1"), children: [] }],
      })) as unknown as typeof fetch);
    await expect(api.list("p")).resolves.toEqual([scenario("a", null, "1")]);
  });
});

describe("orderScenarioTree", () => {
  it("orders depth-first by creation, treating orphans as roots", () => {
    const ordered = orderScenarioTree([
      scenario("c", "a", "3"),
      scenario("b", "a", "2"),
      scenario("a", null, "1"),
      scenario("d", "b", "4"),
      scenario("orphan", "missing", "5"),
    ]);
    expect(ordered.map(({ scenario: s, depth }) => `${s.id}:${depth}`)).toEqual(
      ["a:0", "b:1", "d:2", "c:1", "orphan:0"],
    );
  });
});
