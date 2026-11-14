# Intake agent: four-category founder role-play

Ticket: HAC-38 · Last run: pending · App URL: `<Vercel preview URL>`

## Preconditions

- Use a Vercel preview with HAC-19's **live** intake endpoint and an approved model credential; never put a key in this script, browser messages, screenshots or the ticket.
- Browser and viewport: Chrome, 1440 × 900. The intake screen must actually send messages to `POST /api/projects/[projectId]/intake`; if it still says “This conversation uses a fixture,” stop and report the missing integration rather than grading the fixture as an agent.
- Use the provisioned `houston-coffee` project on the preview for all four personas; clear its saved intake state between runs. Do not invent project IDs (unknown projects return 404). No real founder or customer personal information is needed.
- A computer-use agent should follow each persona's **true values** as its private script. It may answer clarifying questions naturally, but must not supply facts absent from the persona. Use “I don't know” for unavailable details, not an invented number.
- Take a screenshot after each step and save one labelled finished-profile screenshot per persona. Do not capture API keys, browser console tokens, or the developer tools network panel.

## Personas (private instructions to the role-player)

| Persona | Backstory and city | True price | True stations / staffing | True budgets |
|---|---|---|---|---|
| Coffee shop — Marta | Opening an espresso bar near Montrose, Houston for morning commuters and remote workers. Hours 07:00–17:00, frontage preferred, parking unknown. | Average ticket **$6.50**, mid-tier. | **2** baristas/service stations. | Monthly rent ceiling **$4,500**, buildout **$120,000**; total startup budget unknown. |
| Quick food — Dev | Opening a counter-service lunch shop near downtown Los Angeles for office workers; wants fast pickup, but has not chosen a precise district. Hours 10:00–20:00. Be deliberately **vague** until the agent asks a specific question. | Average ticket **$12**, mid-tier. | **3** service stations/staff on shift. | Monthly rent ceiling **$7,000**, buildout **$90,000**; monthly operating budget unknown. |
| Salon/barber — Leila | A Houston neighborhood barber/salon; initially says there will be **2 chairs**, then **changes her mind to 4 chairs** and says to use 4 as the final truth. Hours 10:00–19:00, parking essential. | Average ticket **$35**, mid-tier. | Final **4** chairs/stations, **4** staff; initial 2 is explicitly superseded. | Monthly rent ceiling **$3,200**, buildout **$55,000**. |
| Fitness studio — Ash | A Los Angeles small-group fitness studio, neighborhood flexible, evening customers; hours 06:00–21:00. Tell the agent numbers for attendance or demand are unknown rather than inventing them. | Average visit/ticket **$20**, mid-tier. | **2** coaching stations and **2** staff on shift. | Monthly rent ceiling **$6,000**, buildout **$80,000**. |

## Steps

Repeat steps 1–7 for **each** persona; keep transcripts/screenshots separate. When the agent asks a must-have or an unprovided field, state whether it is known; an explicit unknown should remain unknown, not zero.

| # | Do | Expected result |
|---|---|---|
| 1 | Clear the previous persona's `sitework:intake:v1:houston-coffee` browser draft (or use a fresh private window), then open `<preview>/projects/houston-coffee/intake`. | A live intake conversation starts without a fixture-only message or a provider error. Screenshot the initial state. |
| 2 | Say the persona's introductory sentence, category and city, without volunteering all numbers. | The agent acknowledges those facts and asks a relevant missing question; record whether it repeated a question already answered. |
| 3 | Answer the agent's questions using only the persona's true values; count each founder message as one turn. | Price, stations/staff, rent ceiling, buildout budget, city and other required fields are recorded correctly with `founder` origin. Record skipped or repeated questions. |
| 4 | For Leila, explicitly correct the earlier two-chair answer to four chairs after it was saved. | Final profile shows four chairs/stations, not two; the correction has `founder` origin. |
| 5 | When the category-derived visits-per-customer assumption appears, ask where the number came from; Marta then says to use **6 visits/month**. | Unmodified assumptions remain visibly `default`; the visits/month override is `founder`. No number is presented as measured fact without its origin. |
| 6 | When the agent says the profile is complete, review the entire finished profile and all finding/assumption text. | True values match; stated unknowns are unknown, not 0. The agent never claims a guaranteed sales forecast. |
| 7 | Capture the finished profile and copy the results into the HAC-38 ticket. | A labelled screenshot and row in the results table exist for this persona; link evidence without exposing credentials. |

## Results (paste into HAC-38)

| Persona | Pass / Fail | Final values match? | Founder turns | Repeated/skipped questions | Forecast or unsourced numbers? | Finished-profile screenshot | Notes |
|---|---|---|---:|---|---|---|---|
| Coffee — Marta | Pending | | | | | | |
| Quick food — Dev | Pending | | | | | | |
| Salon/barber — Leila | Pending | | | | | | |
| Fitness — Ash | Pending | | | | | | |

If a live run uncovers a real defect, check for duplicates, file an HAC Bug-template ticket against HAC-19's feature owner with Brief Description / Reproduction Steps / Test Cases, relate it to HAC-19 and HAC-38, attach the redacted screenshot or trace, and mark a deterministic regression `test.fixme(true, 'HAC-n: ...')`. See `tests/manual/README.md` for the full reporting procedure. Do not silently fix the app inside this test ticket.
