export const APP_VERSION = process.env.NEXT_PUBLIC_APP_VERSION;

// The release the server runs (the production Compose file sets it from
// LICTORY_VERSION); `development` for a source checkout, also when the
// variable is set but empty.
export function serverVersion() {
  const version = process.env.APP_VERSION?.trim();
  return version?.length ? version : "development";
}
