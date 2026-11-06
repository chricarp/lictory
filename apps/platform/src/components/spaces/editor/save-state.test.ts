import assert from "node:assert/strict";
import { test } from "node:test";
import {
  nextSaveTiming,
  saveStateOf,
  shownSaveState,
  type SessionSnapshot,
} from "@lictory/platform/components/spaces/editor/session";

type Patch = Partial<Omit<SessionSnapshot, "save">>;

const connected = "connected" as SessionSnapshot["status"];
const disconnected = "disconnected" as SessionSnapshot["status"];

function synced(): SessionSnapshot {
  const s = {
    status: connected,
    everSynced: true,
    unsynced: false,
    storedSequence: 1,
    readOnly: false,
    online: true,
    unavailable: false,
    closed: null,
    peers: [],
  };
  return { ...s, save: nextSaveTiming(null, saveStateOf(s).kind, 0) };
}

// Replays session events at the given times together with the indicator's
// own wake-ups (the deadlines `useShownSaveState` sets a timer for), and
// returns every change of what is shown and announced. Deterministic: time
// is the event times and deadlines, nothing else.
function replay(events: [number, Patch][], until: number, start = synced()) {
  let snapshot = start;
  const shown: string[] = [];
  const announced: string[] = [];
  // Whether the truth was "saved" whenever the indicator showed "Saved".
  const claims: { at: number; truth: string }[] = [];
  const render = (at: number) => {
    const s = shownSaveState(snapshot, at);
    const label = `${at} ${s.state.label}${s.slow ? " (spinner)" : ""}`;
    // A state replaced at the same instant was never on screen.
    if (shown.at(-1)?.startsWith(`${at} `)) shown.pop();
    if (shown.at(-1)?.replace(/^\d+ /, "") !== label.replace(/^\d+ /, ""))
      shown.push(label);
    if (
      s.announcement &&
      announced.at(-1)?.split(" ").slice(1).join(" ") !== s.announcement
    )
      announced.push(`${at} ${s.announcement}`);
    if (s.state.kind === "saved")
      claims.push({ at, truth: saveStateOf(snapshot).kind });
    return s.wakeAt;
  };
  let wakeAt = render(0);
  let i = 0;
  for (;;) {
    const eventAt = events[i]?.[0] ?? Infinity;
    const at = Math.min(eventAt, wakeAt ?? Infinity);
    if (at > until) break;
    if (eventAt === at) {
      const next = { ...snapshot, ...events[i]![1] };
      snapshot = {
        ...next,
        save: nextSaveTiming(snapshot.save, saveStateOf(next).kind, at),
      };
      i += 1;
    }
    wakeAt = render(at);
  }
  return { shown, announced, claims };
}

// One keystroke every `every` ms from `from`, each stored `storedAfter` ms
// later (the provider's unsynced flag goes up, then down).
function typing(from: number, count: number, every: number, storedAfter = 15) {
  const events: [number, Patch][] = [];
  for (let k = 0; k < count; k += 1) {
    const at = from + k * every;
    events.push(
      [at, { unsynced: true }],
      [at + storedAfter, { unsynced: false }],
    );
  }
  return events;
}

void test("continuous typing with fast saves shows one quiet change, then Saved once typing pauses", () => {
  // 25 keystrokes, 120 ms apart, each stored in 15 ms: the truth flips 50 times.
  const { shown, announced } = replay(typing(100, 25, 120), 10_000);
  assert.deepEqual(shown, ["0 Saved", "100 Saving…", "3995 Saved"]);
  assert.deepEqual(announced, [], "routine saves are never announced");
});

void test("a short pause between bursts does not flash Saved; a longer one does", () => {
  const short = replay(
    [...typing(0, 5, 100), ...typing(415 + 600, 5, 100)],
    10_000,
  );
  assert.deepEqual(short.shown, ["0 Saving…", "2430 Saved"]);
  const long = replay(
    [...typing(0, 5, 100), ...typing(415 + 1500, 5, 100)],
    10_000,
  );
  assert.deepEqual(long.shown, [
    "0 Saving…",
    "1415 Saved",
    "1915 Saving…",
    "3330 Saved",
  ]);
});

void test("a slow save shows a spinner after a second, and Saved only after it is stored", () => {
  const slow = replay(
    [
      [0, { unsynced: true }],
      [2500, { unsynced: false }],
    ],
    10_000,
  );
  assert.deepEqual(slow.shown, [
    "0 Saving…",
    "1000 Saving… (spinner)",
    "2500 Saving…",
    "3500 Saved",
  ]);
  // Just under the threshold: no spinner at all.
  const fast = replay(
    [
      [0, { unsynced: true }],
      [999, { unsynced: false }],
    ],
    10_000,
  );
  assert.deepEqual(fast.shown, ["0 Saving…", "1999 Saved"]);
});

void test("Saved is never shown while an edit is unstored", () => {
  // Pseudo-random keystrokes, store delays and disconnects (seeded).
  let seed = 7;
  const random = () => (seed = (seed * 48271) % 2147483647) / 2147483647;
  for (let run = 0; run < 50; run += 1) {
    const events: [number, Patch][] = [];
    let at = 0;
    for (let k = 0; k < 40; k += 1) {
      at += Math.floor(random() * 1500);
      const roll = random();
      events.push([
        at,
        roll < 0.45
          ? { unsynced: true }
          : roll < 0.9
            ? { unsynced: false }
            : roll < 0.95
              ? { status: disconnected }
              : { status: connected },
      ]);
    }
    const { claims } = replay(events, at + 5000);
    for (const claim of claims)
      assert.equal(claim.truth, "saved", `Saved shown at ${claim.at}`);
  }
});

void test("losing the connection shows and announces at once; recovery is confirmed once stored", () => {
  const { shown, announced } = replay(
    [
      [0, { unsynced: true }],
      [200, { status: disconnected }],
      [5000, { status: connected }],
      [5040, { unsynced: false }],
      [7000, { unsynced: true }],
      [7015, { unsynced: false }],
    ],
    10_000,
  );
  assert.deepEqual(shown, [
    "0 Saving…",
    "200 Offline — changes kept on this device",
    "5000 Saving…",
    // A recovery is confirmed at once: the person is waiting for it.
    "5040 Saved",
    "7000 Saving…",
    "8015 Saved",
  ]);
  assert.deepEqual(announced, [
    "200 Offline — changes kept on this device",
    "5040 Connection restored. All edits are saved.",
  ]);
});

void test("closed and unavailable sessions show at once, whatever was pending", () => {
  const closed = replay(
    [
      [0, { unsynced: true }],
      [10, { unsynced: false }],
      [300, { closed: "revoked" }],
    ],
    5000,
  );
  assert.equal(closed.shown.at(-1)?.startsWith("300 "), true);
  // The editor's own alerts announce closed and unavailable sessions.
  assert.deepEqual(closed.announced, []);
  const start = { ...synced(), everSynced: false };
  start.save = nextSaveTiming(null, saveStateOf(start).kind, 0);
  const unavailable = replay(
    [
      [8000, { unavailable: true }],
      [9000, { everSynced: true, unavailable: false }],
    ],
    20_000,
    start,
  );
  assert.deepEqual(unavailable.shown, [
    "0 Connecting…",
    "8000 Live editing unavailable",
    "9000 Saved",
  ]);
});

void test("the first sync shows Saved without waiting", () => {
  const start = { ...synced(), everSynced: false };
  start.save = nextSaveTiming(null, saveStateOf(start).kind, 0);
  const { shown, announced } = replay(
    [[300, { everSynced: true }]],
    5000,
    start,
  );
  assert.deepEqual(shown, ["0 Connecting…", "300 Saved"]);
  assert.deepEqual(announced, []);
});

void test("events that do not change the save state keep its timing", () => {
  const s = synced();
  const typingAt = nextSaveTiming(s.save, "saving", 100);
  assert.equal(nextSaveTiming(typingAt, "saving", 900), typingAt);
});
