/**
 * HAC-66: tells the intake screen whether a live intake model is configured. Presence only:
 * it never probes the paid provider or exposes credentials. Without a model the screen stays
 * on its labelled offline fixture.
 */
export function createIntakeCapabilitiesHandler(
  env: Record<string, string | undefined> = process.env,
) {
  return async function GET() {
    return Response.json(
      { modelConfigured: Boolean(env.OPENAI_API_KEY?.trim()) },
      { headers: { "Cache-Control": "private, no-store" } },
    );
  };
}
