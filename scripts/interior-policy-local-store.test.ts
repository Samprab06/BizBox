import { it, expect } from "vitest";
import { mkdtemp, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { createLocalInteriorPolicyStore } from "./interior-policy-local-store";
it("shares one durable historical grant across instances, retains failed reservations and seals one-way", async () => {
  const directory = await mkdtemp(join(tmpdir(), "bizbox-budget-test-"));
  try {
    const path = join(directory, "ledger.json"),
      a = createLocalInteriorPolicyStore(path),
      b = createLocalInteriorPolicyStore(path);
    await a.initialize();
    await expect(b.initialize()).rejects.toThrow("already exists");
    expect(
      await a.store.reserve(
        "bizbox-interior-2026-11-15",
        "a",
        "p",
        "key",
        1000,
      ),
    ).toBe("reserved");
    expect((await b.inspect()).reservedMicrousd).toBe(27864);
    expect(
      await b.store.reserve(
        "bizbox-interior-2026-11-15",
        "b",
        "p",
        "key",
        1000000,
      ),
    ).toBe("exhausted");
    const receipt = await a.seal();
    expect(receipt.reservedMicrousd).toBe(27864);
    await expect(
      b.store.reserve("bizbox-interior-2026-11-15", "c", "p", "key", 1000),
    ).rejects.toThrow("sealed");
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});
