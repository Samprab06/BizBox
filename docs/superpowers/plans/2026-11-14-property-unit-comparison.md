# Real property and unit comparison

Goal: replace ambiguous sample review with a simple real-data unit selection and two-choice comparison.
Spec: docs/superpowers/specs/2026-11-14-client-flow-design.md (real property/unit comparison follow-up).

- [x] Confirm existing hosted database health and actual preview listing search recover; preserve real-service errors.
- [x] Retire `/review/client-flow` entry via redirect to the canonical Houston workspace, remove obsolete review-flow E2E assertions.
- [x] Frontend: stable per-property display labels, consistent property/list/tray/results identities; explicit manual shortlist of up to two units and remove/choose another actions.
- [x] Frontend: facts-first comparison with existing model-run API action, selection-scoped results and errors; remove hidden duplicate More controls; preserve camera/chat/URL.
- [x] Manager: exact-source checks, meaningful manual-choice E2E and actual real-data desktop browser proof, docs and local delivery.

Boundaries: no new API contracts, provider or runtime, no simulation math, no production credentials copied. Existing non-workspace comparison consumers retain their default selection policy. Labels are not asserted to be official broker suite numbers. Desktop only; preserve unrelated onboarding/prototype work.

Verification: exact-source lint/typecheck/build PASS, 1,433 unit tests PASS (43 existing skips), 78 desktop Chromium PASS (2 existing skips). Native actual real-data IAB verified 0/2 initial, numbered units, source two-choice facts, failed local model run retaining facts/Retry, chat beside comparison and 499 px document width equal to viewport. Screenshots /tmp/bizbox-real-numbered-units-final.png and /tmp/bizbox-real-unit-comparison-final.png. Unrelated onboarding/prototype WIP preserved; clean snapshot excludes the known interrupted prototype test. Existing build tracing warning remains. Local delivery only.
