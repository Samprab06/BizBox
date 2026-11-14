# City playback statistics (HAC-78)

`components/city/stats-card.tsx` is a controlled, solid-surface analysis card for
the city or interior view. The host passes its existing playback minute, playing
state and speed (1×, 6×, 18×, 60×), and handles the callbacks. The card starts no
timer and reruns no simulation. It can be positioned over a canvas by the host.

`statsAt(runs, minute)` consumes chronological `DayResult` engine events. Served,
walk-aways and line length come from `replayAt`; revenue includes completed
services at or before the selected minute, including closing-boundary events.
The purchase sparkline ends at the selected minute and does not reveal future
purchases. The current wait is labelled **Longest current wait**: elapsed time
among customers still queued, zero when the queue is empty. It is not a forecast
of a new customer's wait or an average over finished services.

Area overview requires one run per distinct site from the same scenario and day,
with matching opening hours. Duplicate sites, incompatible clocks, an empty run
list and nonfinite seek values fail explicitly. The host must supply runs from
the same scenario; `DayResult` alone does not identify a scenario. Area selection
is disabled when no area runs are supplied. Seeks clamp to the operating day.
Every value is labelled modeled; the revenue is USD and excludes unfinished
services. No new API, database, persisted contract or dependency is introduced.

Verification covers arbitrary fractional seek times, reversal, exact closing
totals, agreement with hourly bucket totals, aggregation, current queue waits,
invalid clocks and duplicate sites. The standalone component passed a temporary local browser harness at 375, 768
and 1440 px with no horizontal overflow, keyboard Play/Pause and Home/End seek,
speed selection, site/area selection and zero axe WCAG A/AA violations. The
harness used real seeded engine outputs and a controlled parent; it has been
removed from the app. City-view mounting and end-to-end integration remain
HAC-77-dependent. HAC-78 is not complete until that integration is exercised.
