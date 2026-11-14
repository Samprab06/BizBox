# Scenario API: history slice (HAC-81)

This local first slice exposes immutable scenario history through the existing
HAC-80 repository. HAC-81 remains In Development: evaluation, persisted resumable
run checkpoints, cache reuse and atomic project-budget enforcement are not yet
implemented. There is deliberately no run endpoint that could bypass those checks.

## Routes

- `POST /api/projects/:projectId/scenarios`: create a root with `siteIds`,
  `profileVersion`, `label`, optional `overrides` and `layoutId`; or fork with
  `{ fromId, patch }`. `author` defaults to `founder`; agent changes require
  `author: "agent"` and a rationale and retain the existing provenance restrictions.
- `GET /api/projects/:projectId/scenarios`: `{ tree: [{ scenario, children }] }`.
- `GET /api/projects/:projectId/scenarios/:id`: `{ scenario }`; with `?against=:id`,
  also returns the existing field-level diff from `against` to the requested version.
- `POST /api/projects/:projectId/scenarios/:id/revert-to`: `{ targetId, author?, rationale? }`.
  Creates a new child of the current version with the target's contents. History is
  retained, including the current version and the target.

IDs and timestamps are server generated. All reads and mutations are scoped to the
project in the URL; forks, diffs and reverts cannot cross projects. Patch fields are
strictly allowlisted and replace the full overrides object, matching HAC-80's model.
There is no PATCH or DELETE route. Database foreign keys continue to enforce project
and profile-version existence. This preserves the existing application's project
scoping; it adds no authentication policy.

Bodies are limited to 64 KiB; malformed JSON and invalid values return 422. Missing
scenarios/projects/profile versions return 404, identity conflicts 409, and storage
failures a sanitized 503. Responses use `Cache-Control: private, no-store`.

## Remaining execution work

Before exposing `POST .../:id/run`, persist a server-side, project-scoped execution
record with request identity, site-by-site checkpoints and fenced leases. Reserve
site × seed × day-type work units atomically before assembling or running anything.
An over-budget request must return `needs_confirmation` and do no work; a request
cannot self-authorize an arbitrary budget increase. Repeated requests and cached
equivalent forks must not duplicate simulation or consume budget twice.

Use the existing `evaluateSitesResumable` and its completed-site callback. Preserve
the exact scenario profile version and every supported override, including explicit
seed sets, and store the scenario-run/comparison linkage. Do not silently ignore a
layout or seed set that is not yet supported. Agree the project-budget policy with
the lead before choosing a hardcoded execution allowance. These requirements are
not covered by the history routes' current tests.

## Checks

Targeted history-service and HTTP tests cover root/fork/revert immutability, tree and
diff shape, cross-project rejection, strict patches, author/provenance restrictions,
input limits, and sanitized storage errors. Required repository checks remain
lint, typecheck, full Vitest and production build. Remote preview and database
checks require the normal approved review flow; no remote mutation is needed to run
the offline tests.
