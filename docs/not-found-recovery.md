# Not-found recovery (HAC-169)

Unmatched URLs use the server-rendered `app/not-found.tsx` with the existing
BizBox logo, shared neutral tokens and a home link. Missing project resources
use `app/(pages)/projects/not-found.tsx`, above the `[projectId]` layout. That
placement replaces the consultant layout instead of hiding recovery inside a
previously expanded assistant; it also avoids duplicate brand headers.

The project boundary has no params prop in this Next.js version. A small client
component reads the pathname and builds a map link from a bounded project slug or
generated ID. Invalid encoding, separators and dot segments fall back to home.
The boundary does not fetch data or claim that an unknown project exists.

Both boundaries preserve the existing `notFound()` behavior and HTTP status.
They introduce no rewrite, middleware, experimental framework flag or API.
Browser checks cover a global unknown URL and an unknown site after saved
assistant focus, including HTTP 404, visible/keyboard-accessible recovery and axe.
