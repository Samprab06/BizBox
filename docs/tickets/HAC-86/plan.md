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

Manager owns the final review and any remote delivery. No layout table, scenario FK, scan-to-layout adapter, scenario evaluation wiring or externally visible layout endpoint was added. The pure model is ready for those downstream integrations; the broader ticket remains In Development.
