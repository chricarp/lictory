// The ports the browser suite (scripts/test-e2e.ts) listens on, shared with
// `bun run verify` (scripts/verify.ts), which picks a free E2E_PORT_OFFSET
// when the default ports are taken. Offsets are multiples of 10: the services
// take consecutive ports, and zero-cache's pair moves ten times as far.
import { createConnection } from "node:net";

export function e2ePorts(offset: number) {
  return {
    edge: 3001 + offset,
    api: 3002 + offset,
    workerHealth: 3003 + offset,
    collaboration: 3004 + offset,
    marketing: 3101 + offset,
    docs: 3201 + offset,
    docsInspector: 9301 + offset,
    zero: 4858 + offset * 10,
    zeroChangeStreamer: 4859 + offset * 10,
    fakeJira: 3005 + offset,
    scriptedAi: 3006 + offset,
  };
}

function listening(port: number, host: string) {
  return new Promise<boolean>((resolve) => {
    const socket = createConnection({ port, host });
    socket.once("connect", () => {
      socket.destroy();
      resolve(true);
    });
    socket.once("error", () => resolve(false));
  });
}

/** The ports of this offset that something already listens on. */
export async function busyPorts(offset: number) {
  const busy: { port: number; host: string }[] = [];
  for (const port of Object.values(e2ePorts(offset)))
    for (const host of ["127.0.0.1", "::1"])
      if (await listening(port, host)) busy.push({ port, host });
  return busy;
}
