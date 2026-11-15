/** Developer tooling only: durable task-local grant. Never imported by app routes. */
import { open, readFile, rename, unlink } from "node:fs/promises";
import { dirname } from "node:path";
import { createHash, randomUUID } from "node:crypto";
import { z } from "zod";
import type { InteriorPolicyStore } from "../lib/interior/policies";
import {
  InteriorJevResponseSchema,
  INTERIOR_JEV_HISTORICAL_MICROUSD,
  INTERIOR_JEV_LIMIT_MICROUSD,
} from "../lib/interior/policies";
const GRANT = "bizbox-interior-2026-11-15";
const Attempt = z
  .object({
    id: z.string(),
    projectId: z.string(),
    key: z.string(),
    amount: z.number().int().positive(),
    at: z.string(),
  })
  .strict();
const Ledger = z
  .object({
    version: z.literal(1),
    grantId: z.literal(GRANT),
    limitMicrousd: z.literal(INTERIOR_JEV_LIMIT_MICROUSD),
    historicalMicrousd: z.literal(INTERIOR_JEV_HISTORICAL_MICROUSD),
    reservedMicrousd: z
      .number()
      .int()
      .min(INTERIOR_JEV_HISTORICAL_MICROUSD)
      .max(INTERIOR_JEV_LIMIT_MICROUSD),
    sealed: z.boolean(),
    attempts: z.array(Attempt),
    cache: z.record(z.string(), InteriorJevResponseSchema),
    claims: z
      .record(z.string(), z.object({ owner: z.string(), expires: z.number() }))
      .default({}),
  })
  .strict()
  .refine(
    (x) =>
      x.reservedMicrousd ===
      x.historicalMicrousd + x.attempts.reduce((n, a) => n + a.amount, 0),
    "Ledger reservation total mismatch",
  );
export const DEFAULT_INTERIOR_LEDGER =
  "/tmp/bizbox-interior-jev-grant-2026-11-15.json";
export function createLocalInteriorPolicyStore(path = DEFAULT_INTERIOR_LEDGER) {
  const lockPath = `${path}.lock`,
    sealPath = `${path}.handoff.json`;
  async function locked<T>(work: () => Promise<T>) {
    const lock = await open(lockPath, "wx", 0o600).catch(() => {
      throw new Error("Interior grant ledger is locked; no calls permitted");
    });
    try {
      return await work();
    } finally {
      await lock.close();
      await unlink(lockPath);
    }
  }
  const read = async () =>
    Ledger.parse(JSON.parse(await readFile(path, "utf8")));
  async function write(value: z.infer<typeof Ledger>) {
    const data = Ledger.parse(value),
      temp = `${path}.${randomUUID()}.tmp`;
    const handle = await open(temp, "wx", 0o600);
    try {
      await handle.writeFile(JSON.stringify(data, null, 2) + "\n");
      await handle.sync();
    } finally {
      await handle.close();
    }
    await rename(temp, path);
    const directory = await open(dirname(path), "r");
    try {
      await directory.sync();
    } finally {
      await directory.close();
    }
  }
  const writable = (ledger: z.infer<typeof Ledger>) => {
    if (ledger.sealed)
      throw new Error(
        "Interior grant is sealed for database handoff; CLI spending is disabled",
      );
  };
  const store: InteriorPolicyStore = {
    async claim(projectId, key, owner) {
      return locked(async () => {
        const ledger = await read();
        writable(ledger);
        const id = `${projectId}:${key}`,
          existing = ledger.claims[id];
        if (existing && existing.expires > Date.now()) return false;
        ledger.claims[id] = { owner, expires: Date.now() + 120000 };
        await write(ledger);
        return true;
      });
    },
    async release(projectId, key, owner) {
      await locked(async () => {
        const ledger = await read();
        const id = `${projectId}:${key}`;
        if (ledger.claims[id]?.owner === owner) {
          delete ledger.claims[id];
          await write(ledger);
        }
      });
    },
    async assertReady(grantId) {
      await locked(async () => {
        const ledger = await read();
        writable(ledger);
        if (grantId !== ledger.grantId)
          throw new Error("Grant identity mismatch");
      });
    },
    async get(projectId, key) {
      return locked(async () => {
        const ledger = await read();
        writable(ledger);
        return ledger.cache[`${projectId}:${key}`] ?? null;
      });
    },
    async reserve(grantId, id, projectId, key, amount) {
      return locked(async () => {
        const ledger = await read();
        writable(ledger);
        if (
          grantId !== ledger.grantId ||
          !Number.isSafeInteger(amount) ||
          amount <= 0
        )
          return "unavailable";
        if (ledger.reservedMicrousd + amount > ledger.limitMicrousd)
          return "exhausted";
        ledger.reservedMicrousd += amount;
        ledger.attempts.push({
          id,
          projectId,
          key,
          amount,
          at: new Date().toISOString(),
        });
        await write(ledger);
        return "reserved";
      });
    },
    async put(projectId, key, response) {
      await locked(async () => {
        const ledger = await read();
        writable(ledger);
        ledger.cache[`${projectId}:${key}`] =
          InteriorJevResponseSchema.parse(response);
        await write(ledger);
      });
    },
  };
  return {
    store,
    async initialize() {
      return locked(async () => {
        try {
          await readFile(sealPath);
          throw new Error("A database handoff receipt already exists");
        } catch (e) {
          if ((e as NodeJS.ErrnoException).code !== "ENOENT") throw e;
        }
        try {
          await readFile(path);
          throw new Error("Grant ledger already exists; never reset it");
        } catch (e) {
          if ((e as NodeJS.ErrnoException).code !== "ENOENT") throw e;
        }
        const ledger = Ledger.parse({
          version: 1,
          grantId: GRANT,
          limitMicrousd: INTERIOR_JEV_LIMIT_MICROUSD,
          historicalMicrousd: INTERIOR_JEV_HISTORICAL_MICROUSD,
          reservedMicrousd: INTERIOR_JEV_HISTORICAL_MICROUSD,
          sealed: false,
          attempts: [],
          cache: {},
        });
        await write(ledger);
        return ledger;
      });
    },
    async inspect() {
      return locked(read);
    },
    async seal() {
      return locked(async () => {
        const ledger = await read();
        writable(ledger);
        if (
          Object.values(ledger.claims).some(
            (claim) => claim.expires > Date.now(),
          )
        )
          throw new Error("Cannot seal a grant with active provider claims");
        ledger.sealed = true;
        await write(ledger);
        const receipt = createHash("sha256")
          .update(JSON.stringify(ledger))
          .digest("hex");
        const result = {
          grantId: GRANT,
          reservedMicrousd: ledger.reservedMicrousd,
          receipt,
          sealedAt: new Date().toISOString(),
        };
        const handle = await open(sealPath, "wx", 0o600);
        try {
          await handle.writeFile(JSON.stringify(result, null, 2) + "\n");
          await handle.sync();
        } finally {
          await handle.close();
        }
        return result;
      });
    },
  };
}
