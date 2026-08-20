export async function GET() {
  const fingerprints = process.env.ANDROID_SHA256_CERT_FINGERPRINTS?.split(",")
    .map((value) => value.trim())
    .filter(Boolean);

  if (!fingerprints?.length) {
    return Response.json(
      { error: "ANDROID_SHA256_CERT_FINGERPRINTS is not configured" },
      { status: 503 },
    );
  }

  return Response.json(
    [
      {
        relation: ["delegate_permission/common.get_login_creds"],
        target: {
          namespace: "android_app",
          package_name: process.env.ANDROID_APP_PACKAGE ?? "com.lictory.app",
          sha256_cert_fingerprints: fingerprints,
        },
      },
    ],
    { headers: { "cache-control": "public, max-age=3600" } },
  );
}
