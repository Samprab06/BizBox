# lib/panel: persona builder and Jev customer panel (HAC-15)

Catchment → `buildPersonas` → `PersonaSet` → `runPanel` / `runPanelForSites` (Jev, 4 shuffled
option orders per persona × site, cached) → one `BehaviorTable` per site, consumed by the demand
model (HAC-18).

| File            | What it does                                                                                                                                                                 |
| --------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `contracts.ts`  | Interim Zod schemas (`Persona`, `PersonaSet`, `PersonaBehavior`, `BehaviorTable`, catchment input). Move to `lib/contracts/` when HAC-9 lands.                               |
| `personas.ts`   | 30–100 personas by code from block groups, LODES jobs and pass-by counts. Seeded by catchment id. Integer weights that sum exactly to population, jobs and pass-by per kind. |
| `state.ts`      | Code-built Jev state and questions. Only structured fields are read; ids must be snake_case.                                                                                 |
| `jev-client.ts` | REST client: adaptive concurrency limit (`limiter.ts`, `JEV_CONCURRENCY`, default 32; a 429 halves it and pauses all dispatch), timeout, retry with backoff. The **assumed wire format is isolated in one section** of this file. |
| `cache.ts`      | `JevCache` interface, `MemoryJevCache`, SHA-256 cache key over model + state + questions.                                                                                    |
| `panel.ts`      | Runs the panel, writes each answer to the cache as it arrives, averages orders, reports spread and failed personas.                                                          |

Env: `JEV_API_KEY` (required for live calls), `JEV_BASE_URL` (default `https://api.typesafe.ai`),
`JEV_MODEL` (default `jev-latest`). Requests go to `POST /v1/systemone` in TypeSafe's documented
format ([API reference](https://docs.typesafe.ai/api/system-one.md),
[OpenAPI](https://api.typesafe.ai/openapi.json)). Behavior tables record the version Jev answered
with (for example `jev-1.14.0`). Noul answers carry no confidence, so `|2p - 1|` stands in for it.
The live test in `jev-client.test.ts` runs only when `JEV_API_KEY` is set.

## Speed (HAC-131)

- **Adaptive limiter** (`limiter.ts`): `JEV_CONCURRENCY` (default 32) is the ceiling. A 429 halves
  the cap once per burst and pauses all dispatch for `retry-after`; each success adds one slot.
  A request waiting out a back-off holds no slot.
- **Batched cache I/O**: `runPanelForSites` reads every key of every site with one
  `getMany` (`SELECT ... WHERE cache_key IN (...)`) and writes answers through a `CacheWriter`
  (multi-row upsert every 16 answers or 1 s, and on exit). A warm rerun is one read and zero Jev calls.
- **Bundled orders** (`JEV_BUNDLE_ORDERS=1`, default **off**): one request per persona x site with
  `where_o0..3` and `when_o0..3` as separate Choice questions (own seeded option order each);
  `how_often`, the stay Nouls and the price Nouls are asked once. 4x fewer requests. The
  answers differ slightly from four separate calls, so it needs a small live A/B (mean `where`
  share and `orderSpread`) before it becomes the default.
- Tests run the real client, limiter and Postgres cache SQL against `__fixtures__/jev-sim.ts`
  (fake `fetch` with latency and an org rate limit, fake executor) on fake timers.

## Proposed `jev_cache` table (for `lib/db/schema.ts`, HAC-9)

Not wired yet; add this once HAC-9's Drizzle schema exists, then implement `JevCache` over it
(`get` = select by key, `set` = insert ... on conflict do nothing).

```ts
// import { pgTable, text, jsonb, timestamp } from "drizzle-orm/pg-core";
//
// export const jevCache = pgTable("jev_cache", {
//   /** hex SHA-256 of JSON.stringify({ model, state, questions }) — see lib/panel/cache.ts */
//   key: text("key").primaryKey(),
//   modelVersion: text("model_version").notNull(),          // "jev-1.14.0"
//   /** JevAskResult: { modelVersion, answers: { [question]: { probabilities, confidence } } } */
//   result: jsonb("result").notNull(),
//   createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
// });
```
