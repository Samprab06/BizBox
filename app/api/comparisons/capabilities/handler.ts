/** Reports configuration presence only, without probing a paid provider or exposing secrets. */
export function createComparisonCapabilitiesHandler(
  env: Record<string, string | undefined> = process.env,
) {
  return async function GET() {
    return Response.json(
      { jevConfigured: Boolean(env.JEV_API_KEY?.trim()) },
      {
        headers: { "Cache-Control": "private, no-store" },
      },
    );
  };
}
