export async function GET() {
  const teamId = process.env.APPLE_TEAM_ID;
  const bundleId = process.env.APPLE_APP_BUNDLE_IDENTIFIER ?? "com.lictory.app";

  if (!teamId) {
    return Response.json(
      { error: "APPLE_TEAM_ID is not configured" },
      { status: 503 },
    );
  }

  return Response.json(
    {
      applinks: { apps: [], details: [] },
      webcredentials: { apps: [`${teamId}.${bundleId}`] },
    },
    {
      headers: {
        "cache-control": "public, max-age=3600",
        "content-type": "application/json",
      },
    },
  );
}
