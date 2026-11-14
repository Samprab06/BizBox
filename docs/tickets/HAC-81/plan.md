# HAC-81 execution plan

Akshar requested parallel backlog pickup on 2026-11-14. This branch owns scenario
service/API work; HAC-86 owns layouts/queue capacity, HAC-71 the decision UI, and
HAC-96 the interior registry. Ticket descriptions are the spec.

- [x] Reuse immutable HAC-80 model/repository; add scoped create/fork/tree/get/diff/revert service.
- [x] Add bounded HTTP handlers and lazy server-only runtime adapters, without new dependencies.
- [x] Test immutability, isolation, validation and safe failures before exposing history routes.
- [ ] Persist fenced, resumable runs and atomically reserve project work units.
- [ ] Apply every supported override, preserve source snapshots and explicit seed sets.
- [ ] Reuse equivalent completed comparisons without re-running or double-charging budget.
- [ ] Prove over-budget no-work, same-override cached fork and interrupted-run resume behavior.
- [ ] Run four repository checks and manager review for the execution-complete candidate.

History-only behavior and remaining execution policy are documented in
`docs/scenario-api.md`. Keep the ticket In Development; no PR, push, migration or
deployment is authorized by this local implementation work.
