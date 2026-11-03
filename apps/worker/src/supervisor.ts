import type { WorkKind } from "@lictory/core/jobs/signal";
import { describeError, type Log } from "@lictory/worker/log";

// Runs each background job in its own loop: at most one run in flight per
// job, a polling interval, immediate re-runs while a job reports more work,
// coalesced wake-ups from work signals and exponential backoff after
// failures. Loops never wait on each other, so one failing job cannot stall
// the rest. Correctness across several worker processes comes from the jobs
// themselves (leases, SKIP LOCKED, organization locks), not from here.

export type JobContext = {
  // Aborts as soon as shutdown starts: stop before the next unit of work.
  stopping: AbortSignal;
  // Aborts when the shutdown budget is nearly spent: cancel external calls.
  cancel: AbortSignal;
};

export type JobResult = {
  // Run again right away (a full batch was processed).
  more?: boolean;
  counts?: Record<string, number>;
};

export type Job = {
  name: string;
  // Work signal that wakes this job early.
  kind?: WorkKind;
  intervalMs: number;
  // How long one run may take before the process reports itself stuck, when
  // it legitimately runs longer than the supervisor's default.
  stuckMs?: number;
  run(context: JobContext): Promise<JobResult>;
};

export type JobStatus = {
  name: string;
  running: boolean;
  runningSinceMs: number | null;
  lastSuccessAt: string | null;
  lastFailureAt: string | null;
  lastErrorCategory: string | null;
  consecutiveFailures: number;
  nextRunAt: string | null;
  runs: number;
};

type Loop = {
  job: Job;
  running: Promise<void> | null;
  startedAt: number | null;
  pending: boolean;
  timer: ReturnType<typeof setTimeout> | undefined;
  nextRunAt: number | null;
  failures: number;
  runs: number;
  lastSuccessAt: number | null;
  lastFailureAt: number | null;
  lastErrorCategory: string | null;
};

export function createSupervisor(
  jobs: Job[],
  options: {
    log: Log;
    // First retry delay after a failure; doubles up to `maxBackoffMs`.
    backoffMs?: number;
    maxBackoffMs?: number;
    // A run in flight longer than this makes the worker unhealthy.
    stuckMs?: number;
  },
) {
  const { log } = options;
  const backoffMs = options.backoffMs ?? 5_000;
  const maxBackoffMs = options.maxBackoffMs ?? 5 * 60_000;
  const stuckMs = options.stuckMs ?? 30 * 60_000;
  const stopping = new AbortController();
  const cancel = new AbortController();
  const context = { stopping: stopping.signal, cancel: cancel.signal };
  const loops: Loop[] = jobs.map((job) => ({
    job,
    running: null,
    startedAt: null,
    pending: false,
    timer: undefined,
    nextRunAt: null,
    failures: 0,
    runs: 0,
    lastSuccessAt: null,
    lastFailureAt: null,
    lastErrorCategory: null,
  }));

  const schedule = (loop: Loop, delayMs: number) => {
    clearTimeout(loop.timer);
    loop.nextRunAt = Date.now() + delayMs;
    loop.timer = setTimeout(() => tick(loop), delayMs);
  };

  const tick = (loop: Loop) => {
    if (stopping.signal.aborted) return;
    if (loop.running) {
      loop.pending = true;
      return;
    }
    clearTimeout(loop.timer);
    loop.timer = undefined;
    loop.nextRunAt = null;
    loop.pending = false;
    loop.startedAt = Date.now();
    loop.running = run(loop);
  };

  const run = async (loop: Loop) => {
    const started = loop.startedAt!;
    let delay = loop.job.intervalMs;
    let failed = false;
    try {
      const result = await loop.job.run(context);
      const durationMs = Date.now() - started;
      const recovered = loop.failures > 0;
      loop.failures = 0;
      loop.lastSuccessAt = Date.now();
      const counts = result.counts ?? {};
      // Idle polls are not logged; work done and recoveries are.
      if (recovered || Object.values(counts).some((n) => n > 0))
        log("info", "worker.job", {
          job: loop.job.name,
          durationMs,
          ...counts,
          ...(recovered ? { recovered: true } : {}),
        });
      if (result.more) delay = 0;
    } catch (error) {
      failed = true;
      loop.failures++;
      loop.lastFailureAt = Date.now();
      const described = describeError(error);
      loop.lastErrorCategory = described.errorCategory;
      delay = Math.min(
        backoffMs * 2 ** (loop.failures - 1),
        Math.max(maxBackoffMs, loop.job.intervalMs),
      );
      log("error", "worker.job_failed", {
        job: loop.job.name,
        durationMs: Date.now() - started,
        consecutiveFailures: loop.failures,
        retryInMs: delay,
        ...described,
      });
    } finally {
      loop.runs++;
      loop.running = null;
      loop.startedAt = null;
      if (!stopping.signal.aborted) {
        // A signal that arrived mid-run may describe work this run missed;
        // after a failure the backoff still wins.
        if (loop.pending && !failed) delay = 0;
        loop.pending = false;
        schedule(loop, delay);
      }
    }
  };

  return {
    // Runs every job now, then on its own cadence.
    start() {
      for (const loop of loops) tick(loop);
    },
    // A work signal: run the matching jobs now, or once more after the run in
    // flight. Jobs backing off after a failure keep their backoff.
    signal(kind: WorkKind) {
      for (const loop of loops)
        if (loop.job.kind === kind && loop.failures === 0) tick(loop);
    },
    // Signals may have been missed (the LISTEN connection was down).
    wakeAll() {
      for (const loop of loops) if (loop.failures === 0) tick(loop);
    },
    status(): JobStatus[] {
      const iso = (ms: number | null) =>
        ms === null ? null : new Date(ms).toISOString();
      return loops.map((loop) => ({
        name: loop.job.name,
        running: Boolean(loop.running),
        runningSinceMs: loop.startedAt ? Date.now() - loop.startedAt : null,
        lastSuccessAt: iso(loop.lastSuccessAt),
        lastFailureAt: iso(loop.lastFailureAt),
        lastErrorCategory: loop.lastErrorCategory,
        consecutiveFailures: loop.failures,
        nextRunAt: iso(loop.nextRunAt),
        runs: loop.runs,
      }));
    },
    // Alive means every loop is either waiting for its next run or running
    // for less than `stuckMs`. Failing jobs (an unreachable Jira or database)
    // are reported but do not make the process unhealthy: a restart would not
    // fix them, and the loops keep retrying.
    healthy() {
      if (stopping.signal.aborted) return false;
      const now = Date.now();
      return loops.every((loop) =>
        loop.running
          ? now - loop.startedAt! < (loop.job.stuckMs ?? stuckMs)
          : loop.timer !== undefined,
      );
    },
    // Stops scheduling, lets runs in flight finish, cancels their external
    // calls after `cancelAfterMs`, and gives up after `timeoutMs`. Resolves
    // true when nothing is left running. Anything cut off is recovered by
    // its lease.
    async stop({
      timeoutMs,
      cancelAfterMs,
    }: {
      timeoutMs: number;
      cancelAfterMs: number;
    }) {
      stopping.abort();
      for (const loop of loops) {
        clearTimeout(loop.timer);
        loop.timer = undefined;
        loop.nextRunAt = null;
      }
      const inflight = loops.flatMap((l) => (l.running ? [l.running] : []));
      if (!inflight.length) return true;
      const cancelling = setTimeout(() => cancel.abort(), cancelAfterMs);
      let deadline: ReturnType<typeof setTimeout> | undefined;
      const finished = await Promise.race([
        Promise.allSettled(inflight).then(() => true),
        new Promise<boolean>((resolve) => {
          deadline = setTimeout(() => resolve(false), timeoutMs);
        }),
      ]);
      clearTimeout(cancelling);
      clearTimeout(deadline);
      return finished;
    },
  };
}

export type Supervisor = ReturnType<typeof createSupervisor>;
