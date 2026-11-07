// Dictation by recorded clips, for every speech-to-text provider except
// OpenAI Realtime (cloud ones and self-hosted Whisper servers). The
// microphone is captured in the browser, cut into clips at natural pauses,
// and each clip is posted to this server, which sends it to the configured
// provider and returns its text. Clips are 16 kHz mono WAV: the one format
// every provider and self-hosted server accepts without conversion.
//
// Nothing is kept: audio lives in memory until its clip is sent.

const RATE = 16_000;
// Speech louder than this (RMS of a buffer, after auto gain) opens a clip.
const SPEECH_RMS = 0.012;
// A pause this long after speech closes the clip.
const PAUSE_MS = 700;
// Clips never exceed this; the server accepts up to 30 s.
const MAX_CLIP_MS = 20_000;
// Audio kept from just before speech starts, so first syllables are not cut.
const PREROLL_MS = 300;

export function segmentDictationSupported() {
  return (
    typeof window !== "undefined" &&
    typeof AudioContext !== "undefined" &&
    !!navigator.mediaDevices?.getUserMedia
  );
}

// Linear resampling to 16 kHz; speech needs nothing finer.
function resample(input: Float32Array, from: number) {
  if (from === RATE) return input;
  const ratio = from / RATE;
  const out = new Float32Array(Math.floor(input.length / ratio));
  for (let i = 0; i < out.length; i++) {
    const at = i * ratio;
    const low = Math.floor(at);
    const high = Math.min(low + 1, input.length - 1);
    out[i] = input[low]! + (input[high]! - input[low]!) * (at - low);
  }
  return out;
}

export function encodeWav(samples: Float32Array) {
  const buffer = new ArrayBuffer(44 + samples.length * 2);
  const view = new DataView(buffer);
  const ascii = (offset: number, text: string) => {
    for (let i = 0; i < text.length; i++)
      view.setUint8(offset + i, text.charCodeAt(i));
  };
  ascii(0, "RIFF");
  view.setUint32(4, 36 + samples.length * 2, true);
  ascii(8, "WAVEfmt ");
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true);
  view.setUint16(22, 1, true);
  view.setUint32(24, RATE, true);
  view.setUint32(28, RATE * 2, true);
  view.setUint16(32, 2, true);
  view.setUint16(34, 16, true);
  ascii(36, "data");
  view.setUint32(40, samples.length * 2, true);
  for (let i = 0; i < samples.length; i++) {
    const s = Math.max(-1, Math.min(1, samples[i]!));
    view.setInt16(44 + i * 2, s < 0 ? s * 0x8000 : s * 0x7fff, true);
  }
  return new Blob([buffer], { type: "audio/wav" });
}

const concat = (parts: Float32Array[]) => {
  const out = new Float32Array(parts.reduce((n, p) => n + p.length, 0));
  let at = 0;
  for (const p of parts) {
    out.set(p, at);
    at += p.length;
  }
  return out;
};

export type SegmentRecorder = {
  /** Sends what was said since the last pause, then resolves when every clip is transcribed. */
  finish(): Promise<void>;
  /** Stops at once; clips in flight are ignored. */
  cancel(): void;
};

/**
 * Starts recording `mic`. `onClip` receives each clip in order and returns
 * its text; `onText` gets the transcript so far; `onError` the first failure.
 */
export function recordSegments(
  mic: MediaStream,
  handlers: {
    transcribe: (clip: Blob) => Promise<string>;
    onText: (spoken: string) => void;
    onError: (error: unknown) => void;
    onSpeech?: (speaking: boolean) => void;
  },
): SegmentRecorder {
  const context = new AudioContext();
  const source = context.createMediaStreamSource(mic);
  // ScriptProcessorNode is deprecated but everywhere, and needs no worklet
  // module (which a strict CSP would have to allow).
  const processor = context.createScriptProcessor(4096, 1, 1);
  const rate = context.sampleRate;
  const bufferMs = (4096 / rate) * 1000;
  let preroll: Float32Array[] = [];
  let clip: Float32Array[] = [];
  let speaking = false;
  let quietMs = 0;
  let clipMs = 0;
  let spoken = "";
  let stopped = false;
  let failed = false;
  let cancelled = false;
  // Clips are transcribed one after another, so the text stays in order.
  let queue = Promise.resolve();

  const send = () => {
    if (!clip.length) return;
    const samples = resample(concat(clip), rate);
    clip = [];
    clipMs = 0;
    speaking = false;
    handlers.onSpeech?.(false);
    const wav = encodeWav(samples);
    queue = queue.then(async () => {
      if (failed || cancelled) return;
      try {
        const text = (await handlers.transcribe(wav)).trim();
        if (!text || cancelled) return;
        spoken = spoken ? `${spoken} ${text}` : text;
        handlers.onText(spoken);
      } catch (error) {
        if (cancelled) return;
        failed = true;
        handlers.onError(error);
      }
    });
  };

  processor.onaudioprocess = (event) => {
    if (stopped) return;
    const input = new Float32Array(event.inputBuffer.getChannelData(0));
    let sum = 0;
    for (const v of input) sum += v * v;
    const loud = Math.sqrt(sum / input.length) > SPEECH_RMS;
    if (!speaking) {
      preroll.push(input);
      while (preroll.length * bufferMs > PREROLL_MS) preroll.shift();
      if (loud) {
        speaking = true;
        handlers.onSpeech?.(true);
        clip = preroll;
        clipMs = preroll.length * bufferMs;
        preroll = [];
        quietMs = 0;
      }
      return;
    }
    clip.push(input);
    clipMs += bufferMs;
    quietMs = loud ? 0 : quietMs + bufferMs;
    if (quietMs >= PAUSE_MS || clipMs >= MAX_CLIP_MS) send();
  };
  source.connect(processor);
  // Some browsers only run the processor when it reaches the destination; it
  // writes silence there.
  processor.connect(context.destination);

  const release = () => {
    stopped = true;
    processor.disconnect();
    source.disconnect();
    void context.close().catch(() => undefined);
  };
  return {
    async finish() {
      if (speaking) send();
      release();
      await queue;
    },
    cancel() {
      cancelled = true;
      release();
    },
  };
}
