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
- [x] Verify SQL races and leases in scratch CI (22 tests across four files passed on ad7a0f5; local Docker was unavailable).
- [x] Run four repository checks and manager review for the execution-complete candidate. App, E2E and secret checks also passed in CI on ad7a0f5.

The complete API and lead-approved budget policy are in `docs/scenario-api.md`.
Akshar explicitly authorized finishing, pushing and creating PRs. Hosted migrations,
merge and deployment remain outside that authorization. Keep the ticket In
Development until the verified PR handoff.

Scratch database evidence: [Scenario database checks](https://github.com/Samprab06/BizBox/actions/runs/43623212002) ran the five execution cases plus scenario, layout and interior repositories with synthetic data in an isolated PostGIS service. All 22 tests passed; none were skipped.
