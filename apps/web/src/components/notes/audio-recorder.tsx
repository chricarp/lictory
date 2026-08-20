"use client";

import { AnimatePresence, motion } from "motion/react";
import { Check, Mic, Pause, Play, Square, Trash2 } from "@/components/ui/icons";
import * as React from "react";

import { Button } from "@/components/ui/button";
import { formatDuration } from "@/lib/utils";
import { cn } from "@/lib/utils";

/** Picks the best container the current browser will actually produce. */
function preferredMimeType(): string {
  const candidates = [
    "audio/webm;codecs=opus",
    "audio/webm",
    "audio/mp4",
    "audio/ogg;codecs=opus",
  ];
  if (typeof MediaRecorder === "undefined") return "audio/webm";
  return (
    candidates.find((type) => MediaRecorder.isTypeSupported(type)) ??
    "audio/webm"
  );
}

const BAR_COUNT = 48;

export type AudioRecorderProps = {
  onComplete: (file: File, durationSeconds: number) => void;
  onCancel?: () => void;
  autoStartKey?: number;
  className?: string;
};

/**
 * In-app voice capture. Amplitude is sampled from an AnalyserNode so the user
 * sees their own voice while speaking, which is the difference between a
 * recorder people trust and one they abandon halfway through.
 */
export function AudioRecorder({
  onComplete,
  onCancel,
  autoStartKey,
  className,
}: AudioRecorderProps) {
  const [state, setState] = React.useState<
    "idle" | "recording" | "paused" | "review"
  >("idle");
  const [seconds, setSeconds] = React.useState(0);
  const [levels, setLevels] = React.useState<number[]>(() =>
    Array.from({ length: BAR_COUNT }, () => 0.06),
  );
  const [error, setError] = React.useState<string | null>(null);
  const [preview, setPreview] = React.useState<{
    url: string;
    file: File;
    duration: number;
  } | null>(null);
  const [playing, setPlaying] = React.useState(false);

  const streamRef = React.useRef<MediaStream | null>(null);
  const recorderRef = React.useRef<MediaRecorder | null>(null);
  const chunksRef = React.useRef<Blob[]>([]);
  const audioContextRef = React.useRef<AudioContext | null>(null);
  const frameRef = React.useRef<number>(0);
  const timerRef = React.useRef<ReturnType<typeof setInterval> | null>(null);
  const audioRef = React.useRef<HTMLAudioElement>(null);
  const secondsRef = React.useRef(0);

  const teardown = React.useCallback(() => {
    cancelAnimationFrame(frameRef.current);
    if (timerRef.current) clearInterval(timerRef.current);
    streamRef.current?.getTracks().forEach((track) => track.stop());
    streamRef.current = null;
    recorderRef.current = null;
    void audioContextRef.current?.close().catch(() => undefined);
    audioContextRef.current = null;
  }, []);

  React.useEffect(() => () => teardown(), [teardown]);
  React.useEffect(
    () => () => {
      if (preview) URL.revokeObjectURL(preview.url);
    },
    [preview],
  );

  const start = React.useCallback(async () => {
    if (recorderRef.current) return;
    setError(null);
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        audio: {
          echoCancellation: true,
          noiseSuppression: true,
          autoGainControl: true,
        },
      });
      streamRef.current = stream;

      const context = new AudioContext();
      audioContextRef.current = context;
      const analyser = context.createAnalyser();
      analyser.fftSize = 512;
      context.createMediaStreamSource(stream).connect(analyser);
      const buffer = new Uint8Array(analyser.frequencyBinCount);

      const sample = () => {
        analyser.getByteTimeDomainData(buffer);
        let peak = 0;
        for (const value of buffer) {
          peak = Math.max(peak, Math.abs(value - 128) / 128);
        }
        setLevels((current) => [
          ...current.slice(1),
          Math.max(0.06, Math.min(1, peak * 1.9)),
        ]);
        frameRef.current = requestAnimationFrame(sample);
      };
      frameRef.current = requestAnimationFrame(sample);

      const mimeType = preferredMimeType();
      const recorder = new MediaRecorder(stream, { mimeType });
      chunksRef.current = [];
      recorder.ondataavailable = (event) => {
        if (event.data.size > 0) chunksRef.current.push(event.data);
      };
      recorder.onstop = () => {
        const blob = new Blob(chunksRef.current, { type: mimeType });
        const extension = mimeType.includes("mp4")
          ? "m4a"
          : mimeType.includes("ogg")
            ? "ogg"
            : "webm";
        const file = new File(
          [blob],
          `voice-note-${new Date().toISOString().slice(0, 19).replace(/[:T]/g, "-")}.${extension}`,
          { type: mimeType.split(";")[0] },
        );
        setPreview({
          url: URL.createObjectURL(blob),
          file,
          duration: secondsRef.current,
        });
        setState("review");
        teardown();
      };
      recorder.start(250);
      recorderRef.current = recorder;

      setSeconds(0);
      secondsRef.current = 0;
      timerRef.current = setInterval(() => {
        secondsRef.current += 1;
        setSeconds(secondsRef.current);
      }, 1_000);
      setState("recording");
    } catch {
      setError(
        "Microphone access was blocked. Enable it in your browser settings to record.",
      );
    }
  }, [teardown]);

  React.useEffect(() => {
    if (autoStartKey) queueMicrotask(() => void start());
  }, [autoStartKey, start]);

  const togglePause = () => {
    const recorder = recorderRef.current;
    if (!recorder) return;
    if (state === "recording") {
      recorder.pause();
      if (timerRef.current) clearInterval(timerRef.current);
      setState("paused");
    } else {
      recorder.resume();
      timerRef.current = setInterval(() => {
        secondsRef.current += 1;
        setSeconds(secondsRef.current);
      }, 1_000);
      setState("recording");
    }
  };

  const stop = () => {
    recorderRef.current?.stop();
    if (timerRef.current) clearInterval(timerRef.current);
  };

  const discard = () => {
    if (preview) URL.revokeObjectURL(preview.url);
    setPreview(null);
    setSeconds(0);
    secondsRef.current = 0;
    setLevels(Array.from({ length: BAR_COUNT }, () => 0.06));
    setState("idle");
    setPlaying(false);
    onCancel?.();
  };

  const keep = () => {
    if (!preview) return;
    onComplete(preview.file, preview.duration);
    URL.revokeObjectURL(preview.url);
    setPreview(null);
    setSeconds(0);
    secondsRef.current = 0;
    setLevels(Array.from({ length: BAR_COUNT }, () => 0.06));
    setState("idle");
  };

  const live = state === "recording" || state === "paused";

  return (
    <div
      className={cn(
        "relative overflow-hidden rounded-md border border-hairline-strong bg-[rgb(var(--surface)/0.04)] p-4",
        state === "recording" && "border-[rgb(var(--danger)/0.4)]",
        className,
      )}
    >
      <div className="flex items-center gap-4">
        <AnimatePresence mode="popLayout" initial={false}>
          {state === "idle" ? (
            <motion.div
              key="idle"
              initial={{ opacity: 0, scale: 0.9 }}
              animate={{ opacity: 1, scale: 1 }}
              exit={{ opacity: 0, scale: 0.9 }}
            >
              <Button variant="primary" size="md" onClick={() => void start()}>
                <Mic />
                Record audio
              </Button>
            </motion.div>
          ) : null}

          {live ? (
            <motion.button
              key="stop"
              type="button"
              onClick={stop}
              initial={{ opacity: 0, scale: 0.9 }}
              animate={{ opacity: 1, scale: 1 }}
              exit={{ opacity: 0, scale: 0.9 }}
              className="relative flex size-11 shrink-0 items-center justify-center rounded-full bg-danger text-white"
              aria-label="Stop recording"
            >
              {state === "recording" ? (
                <motion.span
                  className="absolute inset-0 rounded-full bg-danger"
                  animate={{ scale: [1, 1.6], opacity: [0.5, 0] }}
                  transition={{ duration: 1.6, repeat: Infinity }}
                />
              ) : null}
              <Square className="relative size-4 fill-current" />
            </motion.button>
          ) : null}

          {state === "review" && preview ? (
            <motion.button
              key="play"
              type="button"
              onClick={() => {
                const audio = audioRef.current;
                if (!audio) return;
                if (audio.paused) {
                  void audio.play();
                  setPlaying(true);
                } else {
                  audio.pause();
                  setPlaying(false);
                }
              }}
              initial={{ opacity: 0, scale: 0.9 }}
              animate={{ opacity: 1, scale: 1 }}
              exit={{ opacity: 0, scale: 0.9 }}
              className="flex size-11 shrink-0 items-center justify-center rounded-full border border-hairline-strong bg-surface-strong text-foreground"
              aria-label={playing ? "Pause playback" : "Play recording"}
            >
              {playing ? (
                <Pause className="size-4" />
              ) : (
                <Play className="size-4 translate-x-px" />
              )}
            </motion.button>
          ) : null}
        </AnimatePresence>

        <div className="flex h-11 min-w-0 flex-1 items-center gap-[2px]">
          {levels.map((level, index) => (
            <motion.span
              key={index}
              className={cn(
                "min-h-[3px] w-full rounded-full",
                state === "recording"
                  ? "bg-ember"
                  : state === "review"
                    ? "bg-[rgb(var(--iris)/0.75)]"
                    : "bg-[rgb(var(--hairline)/0.18)]",
              )}
              animate={{ height: `${Math.round(level * 100)}%` }}
              transition={{ duration: 0.12 }}
            />
          ))}
        </div>

        <span className="shrink-0 font-mono text-sm tabular-nums text-muted">
          {formatDuration(preview?.duration ?? seconds)}
        </span>
      </div>

      {live ? (
        <div className="mt-3 flex items-center gap-2">
          <Button variant="ghost" size="sm" onClick={togglePause}>
            {state === "recording" ? <Pause /> : <Play />}
            {state === "recording" ? "Pause" : "Resume"}
          </Button>
          <Button variant="ghost" size="sm" onClick={discard}>
            <Trash2 />
            Discard
          </Button>
        </div>
      ) : null}

      {state === "review" && preview ? (
        <div className="mt-3 flex items-center gap-2">
          <audio
            ref={audioRef}
            src={preview.url}
            onEnded={() => setPlaying(false)}
            className="hidden"
          />
          <Button variant="primary" size="sm" onClick={keep}>
            <Check />
            Add to note
          </Button>
          <Button variant="ghost" size="sm" onClick={discard}>
            <Trash2 />
            Discard
          </Button>
        </div>
      ) : null}

      {error ? <p className="mt-3 text-xs text-danger">{error}</p> : null}
    </div>
  );
}
