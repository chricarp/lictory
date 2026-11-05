// Pure rules about database connection URLs, shared by the migration runner
// (migration-safety.ts) and the compatibility checks (compatibility.ts).

/** Hosts that only exist inside a Compose project or on this machine. */
const internalHosts = new Set([
  "postgres",
  "localhost",
  "127.0.0.1",
  "::1",
  "[::1]",
]);

export function isInternalHost(host: string) {
  return internalHosts.has(host.toLowerCase());
}

/**
 * A connection pooler recognisable from its host name. Zero needs a direct
 * connection for logical replication (even where a recent PgBouncer passes
 * it through), and a transaction pooler breaks the migration runner's session
 * advisory lock. Returns why, or undefined.
 */
export function poolerHostReason(host: string) {
  const name = host.toLowerCase();
  if (name.includes("-pooler."))
    return `${host} is a Neon pooled endpoint (-pooler); use the direct endpoint without -pooler`;
  if (/(^|\.)pooler\.supabase\.com$/.test(name))
    return `${host} is Supabase's Supavisor pooler; use the direct connection (db.<project>.supabase.co)`;
  if (name.includes("pgbouncer")) return `${host} looks like a PgBouncer host`;
  return undefined;
}

/** poolerHostReason, plus the ports PgBouncer and Supavisor usually listen on. */
export function poolerReason(host: string, port: number) {
  return (
    poolerHostReason(host) ??
    (port === 6432 || port === 6543
      ? `port ${port} is a common PgBouncer/Supavisor port`
      : undefined)
  );
}

/** host, port, sslmode, user and database of a URL, without its password. */
export function describeUrl(url: string) {
  const parsed = new URL(url);
  return {
    host: parsed.hostname,
    port: Number(parsed.port || 5432),
    sslmode:
      parsed.searchParams.get("sslmode") ??
      parsed.searchParams.get("ssl") ??
      undefined,
    user: decodeURIComponent(parsed.username),
    database: decodeURIComponent(parsed.pathname.replace(/^\//, "")),
  };
}
