# Intake readiness (HAC-167)

The detailed form's field coverage and the agent's full-profile completeness are
separate facts. The form uses `missingFields` to choose its next prompt and report
invalid visible inputs. Only the existing `session.live.missingRequiredFields`
returned by the intake agent supplies the full-profile verdict; readiness does not
introduce another required-field list or infer it from the guided form.

`intakeReadiness` reports complete only when that authoritative list exists and is
empty, the current form (including invalid unsaved drafts) is valid, and there are
no pending form edits. A filled form without an agent result says its full profile
has not been reviewed. Known missing fields remain visible; missing economics are
explicitly directed to the assistant's existing chat flow. Average ticket, startup
budget and monthly operating budget remain chat questions; no guided/form inputs
are added. Explicit unknown answers retain the agent's existing completeness rule.

A prior agent result becomes stale when the founder edits its form. The existing
`pending` array now tracks edits when an agent result already exists even if the
model is currently offline. Offline prompt answers preserve the previous live
result and mark the changed field pending, so known missing economics are not lost.
The existing reply merger clears only sent edits that did not change in flight;
a fresh authoritative result can then confirm readiness. No storage keys, profile
schema, API contracts or persistence mechanisms are added.

Offline fixture replies and the form-only completion label say the form fields are
filled; they do not claim that the full agent profile is complete. Existing guided
steps, form validation, business values and economics collection remain unchanged.
