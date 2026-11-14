# HAC-81 execution plan

Akshar requested parallel backlog pickup on 2026-11-14. This branch owns scenario
service/API work; HAC-86 owns layouts/queue capacity, HAC-71 the decision UI, and
HAC-96 the interior registry. Ticket descriptions are the spec.

- [x] Reuse immutable HAC-80 model/repository; add scoped create/fork/tree/get/diff/revert service.
- [x] Add bounded HTTP handlers and lazy server-only runtime adapters, without new dependencies.
- [x] Test immutability, isolation, validation and safe failures before exposing history routes.
- [x] Persist fenced, resumable runs and atomically reserve project work units.
- [x] Apply every supported override, preserve source snapshots and explicit seed sets.
- [x] Reuse equivalent completed comparisons without re-running or double-charging budget.
- [x] Prove over-budget no-work, cached fork and interrupted-run resume behavior offline.
- [ ] Verify SQL races and leases in scratch CI (local Docker became unavailable).
- [ ] Run four repository checks and manager review for the execution-complete candidate.

The complete API and lead-approved budget policy are in `docs/scenario-api.md`.
Akshar explicitly authorized finishing, pushing and creating PRs. Hosted migrations,
merge and deployment remain outside that authorization. Keep the ticket In
Development until the verified PR handoff.
