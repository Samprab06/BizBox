# Continuous people replay

User requirement: a dot represents one person, visibly walking rather than jumping between states or disappearing inside the café.

Scope: presentation of existing saved runs only. Preserve arrivals, decisions, queues, service events, counts and economics. Keep the same customer ID through approach, queue, walk to service, service and exit. Compute positions from replay time so seeks/reverse playback reproduce exactly. Remove a person only after finishing an outside exit route. Unknown staff remain absent; known staff remain continuous at closing and can walk out afterward. Unfinished customers are not silently completed or ejected at closing.

Ownership: frontend owns `customer-motion.ts`, `interior-state.ts` and tests. Backend owns scan layout projection and native scene continuity regression tests. Manager owns operating-clock readability and integration/verification. No business engine, provider, data or dependency changes.

Implementation: compile identity-based piecewise movement tracks and interpolate along layout-specific paths. Shared projector uses modeled or scan geometry rather than state-specific coordinate replacement. Existing SDK groups already retain identity; reuse them. Queue advances interpolate from prior position. Abandonment starts at that person's actual current queue position. Bounded visual walking continues until the route endpoint, even when departure events are already counted in engine metrics.

Operating replay defaults to one modeled minute per real second at 1×, with existing faster speeds retained. Neighborhood playback preserves its previous clock. Current operating closing bound remains unchanged; end-of-day unfinished people remain in their saved states.

Acceptance: epsilon-time continuity at arrival/service/abandonment/completion and queue shifts; no duplicate IDs or visibility gaps; consistent identity through departure endpoint; deterministic random seek; scan/model both continuous; unchanged 55/80 served and 52/28 left fixture results; native SDK groups move rather than replacing identities; browser playback visibly moves people with readable speed. Run lint, typecheck, full unit suite, production build and focused browser checks.
