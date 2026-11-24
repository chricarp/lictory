import { mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import path from "node:path";

// Small JSON files in the app's user data directory (servers, settings,
// window state). Writes go to a temporary file renamed over the old one, so
// a crash never leaves half a file; a file that does not parse reads as
// empty and is replaced on the next write.

export function createJsonStore<T>(
  directory: string,
  name: string,
  normalize: (raw: unknown) => T,
) {
  const file = path.join(directory, `${name}.json`);
  let pending: NodeJS.Timeout | null = null;
  let latest: T | null = null;

  function read(): T {
    try {
      return normalize(JSON.parse(readFileSync(file, "utf8")));
    } catch {
      return normalize(undefined);
    }
  }

  function writeNow(value: T) {
    mkdirSync(directory, { recursive: true });
    const temporary = `${file}.${process.pid}.tmp`;
    writeFileSync(temporary, `${JSON.stringify(value, null, 2)}\n`, {
      mode: 0o600,
    });
    renameSync(temporary, file);
  }

  return {
    read,
    write(value: T) {
      latest = null;
      if (pending) clearTimeout(pending);
      pending = null;
      writeNow(value);
    },
    // Coalesces frequent writes (window moves, navigation).
    writeSoon(value: T, delayMs = 500) {
      latest = value;
      if (pending) return;
      pending = setTimeout(() => {
        pending = null;
        if (latest !== null) writeNow(latest);
        latest = null;
      }, delayMs);
    },
    flush() {
      if (pending) clearTimeout(pending);
      pending = null;
      if (latest !== null) writeNow(latest);
      latest = null;
    },
  };
}
