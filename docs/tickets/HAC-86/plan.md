# HAC-86 typed layout implementation plan

> Execute directly in the assigned backend worktree. Manager owns integration and board posts.

**Goal:** Make layout edits affect validated station, queue and seating capacity.

**Architecture:** Pure TypeScript and Zod contracts, separate geometry/model modules, immutable versions with caller-provided IDs. Extend the existing queue engine only with an optional waiting capacity.

**Spec:** Linear HAC-86, `docs/tickets/agentic-business-plan.md` AGT-7, and `docs/layout-model.md`.

**Constraints:** No dependencies, storage, API, auth, service calls, global origin changes or schema migrations. Frontend scope is limited to the manager-authorized evidence mapper and test: `agent-proposed` uses the existing Assumption label. Preserve legacy simulation serialization when queueCapacity is absent. Preserve unrelated files. Manager posts shared contract before integration.

## Review focus

- Zero queue capacity must admit immediate service and reject waiting.
- Nonfinite coordinates, duplicate IDs, unknown targets and reused version IDs must yield field errors.
- Paths that cross or double back cannot inflate queue capacity; accessibility considers all solid footprints.
- Failed operations must leave the source version untouched; successful versions freeze nested data.
- Scan bounds beat listing fallback; provenance and category ceiling survive all edits.

## Tasks

- [x] Write queue-capacity tests: zero/full queue, simultaneous completion, invalid limits, and committed historical JSON digest. Observe new cap cases fail, implement `SiteConfig.queueCapacity` and the arrival admission guard, then pass engine tests.
- [x] Write layout tests for bounds fallback, sourced geometry, immutable add/move/remove/set operations, field errors, fit/overlap/clearance/path/category limits, seating derivation and queue-shortening balk effect. Observe missing exports fail, implement the typed model/geometry and pure scenario diff hook, then pass targeted tests.
- [x] Document geometry limits, defaults, provenance and caller integration in `docs/layout-model.md`.
- [x] Full suite: 690 passed, 19 skipped (70 test files passed, 8 skipped). Initial run found the shared provenance guard needed `agent-proposed`; manager authorized the two-file evidence mapping, and its new table case was observed failing before implementation. Latest focused evidence/layout/capacity checks: 46 passed.
- [x] `pnpm build`: passed. Historical a0ce767 absent-capacity JSON SHA-256 remains `cf515f65a0c19792780c3db845bbbe7627b8576ebd49e4b7d2a431426cdb74cb`.
- [x] `pnpm lint`, `pnpm typecheck` and `git diff --check`: passed.

## Persistence and execution completion

Manager authorized project-scoped immutable layout persistence, reserved migration 0005 after the stable HAC-96 migration 0004, and a pure scenario execution configuration adapter. No layout editor, new auth policy, remote database writes or deployment is included.

- [x] Add `applyLayoutToConfig(layout, config, { plannedStationsOverride? })`; selected layout overrides station and queue capacity, conflicting explicit station overrides fail with structured errors.
- [x] Add server-only repository `insert(projectId, layout)` and `get(projectId, layoutId)`, validating stored geometry on both boundaries. Scoped parent FK protects project and site; scenario FK protects project. No update API; database rejects in-place updates. `loadLayoutDiffHook` preloads project-scoped snapshots for synchronous scenario diffs.
- [x] Generate 0005 after stacking HAC-96, preserving earlier migration history. Fresh local PG17 migration/repository and adapter tests: 9 passed, covering cross-project/site references, ID conflicts, immutable updates, scoped reads, scenario FK and diff preloading. `pnpm lint`, `pnpm typecheck`, `drizzle-kit check` pass.
- [x] Reject whitespace-altered project/layout scope IDs before database access instead of normalizing identity. Combined local layout/scenario repository, adapter and legacy-capacity checks: 22 passed.
- [x] Production build after persistence: passed (TypeScript phase slowed under shared machine contention). Two full-suite attempts passed 760 tests with 24 skipped but each hit one different existing comparison-handler 5000 ms timeout; the unchanged handler file passed all 12 tests in isolation. No timeout or retry settings were changed.
- [ ] Update model integration docs and run the four checks against the final stacked candidate. Manager reviews and handles remote PR delivery.
