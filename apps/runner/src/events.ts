import {
  boundEvent,
  limits,
  type RunnerEvent,
} from "@lictory/core/factory/protocol";
import { ProtocolError, delay } from "@lictory/runner/client";

// A session's outgoing event log. Events get consecutive sequence numbers
// and are sent in bounded batches; the server stores each sequence once,
// so a batch resent after a lost response is harmless. Streaming text is
// coalesced: one `message` event per message, not one per token.

export type EventType = RunnerEvent["type"];
type Send = (
  events: RunnerEvent[],
) => Promise<{ acked: number; status: string }>;

const FLUSH_MS = 300;
// Streaming text is sent after this much quiet, or when something else
// happens.
const TEXT_IDLE_MS = 1_000;

export class EventStream {
  private seq = 0;
  private acked = 0;
  private pending: RunnerEvent[] = [];
  private text: { type: "message" | "reasoning"; value: string } | null = null;
  private textAt = 0;
  private timer: ReturnType<typeof setInterval> | undefined;
  private flushing: Promise<void> | null = null;
  // The server's view of the session status after the last batch.
  status: string | null = null;
  // Set when the lease is gone: nothing more can be written.
  lost: ProtocolError | null = null;

  constructor(
    private readonly send: Send,
    private readonly onLost: (error: ProtocolError) => void = () => undefined,
  ) {}

  start() {
    this.timer ??= setInterval(() => void this.flush(), FLUSH_MS);
    return this;
  }

  get lastSeq() {
    return this.seq;
  }

  push(type: EventType, data: Record<string, unknown>) {
    this.closeText();
    this.enqueue(type, data);
  }

  // Streaming text: deltas of one message are joined.
  pushText(type: "message" | "reasoning", delta: string) {
    if (this.text && this.text.type !== type) this.closeText();
    this.text ??= { type, value: "" };
    this.text.value += delta;
    this.textAt = Date.now();
    if (this.text.value.length >= limits.text) this.closeText();
  }

  // Ends the current streamed message, if any.
  closeText() {
    if (!this.text) return;
    const { type, value } = this.text;
    this.text = null;
    if (value.trim()) this.enqueue(type, { text: value });
  }

  private enqueue(type: EventType, data: Record<string, unknown>) {
    if (this.lost) return;
    this.pending.push({
      seq: ++this.seq,
      type,
      at: new Date().toISOString(),
      data: boundEvent(data),
    });
  }

  // Sends everything queued so far. Concurrent calls share one flush.
  async flush(): Promise<void> {
    if (this.text && Date.now() - this.textAt > TEXT_IDLE_MS) this.closeText();
    if (this.flushing) return this.flushing;
    if (!this.pending.length || this.lost) return;
    this.flushing = this.drain().finally(() => {
      this.flushing = null;
    });
    return this.flushing;
  }

  private batch() {
    const batch: RunnerEvent[] = [];
    let bytes = 0;
    for (const event of this.pending) {
      const size = JSON.stringify(event).length;
      if (
        batch.length &&
        (batch.length >= limits.batchEvents ||
          bytes + size > limits.batchBytes - 4096)
      )
        break;
      batch.push(event);
      bytes += size;
    }
    return batch;
  }

  private async drain() {
    for (let failures = 0; this.pending.length && !this.lost;) {
      const batch = this.batch();
      try {
        const result = await this.send(batch);
        failures = 0;
        this.acknowledge(result.acked);
        this.status = result.status;
      } catch (error) {
        if (error instanceof ProtocolError) {
          if (error.kind === "sequence_gap" && error.acked !== undefined) {
            // The server has less (or more) than we thought: resend after it.
            this.acknowledge(error.acked);
            continue;
          }
          if (error.fatal) {
            this.lost = error;
            this.pending = [];
            this.onLost(error);
            return;
          }
          if (!error.retryable) {
            // A malformed event would block the log for good: keep its
            // sequence and replace it with a note of the refusal. A refused
            // note ends the stream.
            if (batch.every((e) => e.data.refused === true)) {
              this.lost = error;
              this.pending = [];
              this.onLost(error);
              return;
            }
            const refused = new Set(batch.map((e) => e.seq));
            this.pending = this.pending.map((e) =>
              refused.has(e.seq)
                ? {
                    seq: e.seq,
                    type: "error",
                    at: e.at,
                    data: {
                      message: `A ${e.type} event was refused by the server: ${error.message.slice(0, 500)}`,
                      refused: true,
                    },
                  }
                : e,
            );
            continue;
          }
        }
        failures++;
        await delay(Math.min(15_000, 250 * 2 ** failures));
      }
    }
  }

  private acknowledge(acked: number) {
    this.acked = Math.max(this.acked, acked);
    this.pending = this.pending.filter((e) => e.seq > this.acked);
  }

  // Flushes everything, including streamed text, and stops the timer.
  async close() {
    this.closeText();
    if (this.timer) clearInterval(this.timer);
    this.timer = undefined;
    for (let i = 0; i < 20 && this.pending.length && !this.lost; i++) {
      await this.flush();
      if (this.pending.length) await delay(250);
    }
  }
}
