import { useCallback, useEffect, useRef, useState } from "react";
import {
  recordSegments,
  segmentDictationSupported,
  type SegmentRecorder,
} from "@lictory/platform/components/intelligence/chat/segment-recorder";

// Dictation in one of the server's two modes (directory.ai.dictationMode):
// - realtime: live over WebRTC. The microphone streams straight to the
//   speech-to-text provider using a short-lived credential from our server;
//   nothing is recorded or uploaded here, and the audio is gone once the call
//   closes.
// - segments: clips cut at pauses are posted to our server, which sends each
//   to the configured provider (cloud or self-hosted) and returns its text
//   (segment-recorder.ts). Words arrive after each pause.

export type DictationState = "idle" | "connecting" | "listening" | "finishing";

type Session = {
  token: string;
  callsUrl: string;
};

type Handlers = {
  // Full transcript so far. `final` is the provider's corrected transcript.
  onText: (spoken: string, final: boolean) => void;
  onEnd: (reason: "done" | "cancelled" | "error") => void;
};

// Audio still in flight when the person stops; committing earlier would cut
// off their last word.
const TAIL_MS = 350;
const FINAL_TIMEOUT_MS = 10_000;

type Run = {
  abort: AbortController;
  recorder?: SegmentRecorder;
  mic?: MediaStream;
  pc?: RTCPeerConnection;
  channel?: RTCDataChannel;
  spoken: string;
  // The provider item this dictation fills. Audio still in flight after the
  // commit opens another item; its words are not part of this dictation.
  item?: string;
  timers: ReturnType<typeof setTimeout>[];
  stopping: boolean;
  ended: boolean;
};

export type DictationMode = "realtime" | "segments";

export function dictationSupported(mode: DictationMode = "realtime") {
  if (mode === "segments") return segmentDictationSupported();
  return (
    typeof window !== "undefined" &&
    typeof RTCPeerConnection !== "undefined" &&
    !!navigator.mediaDevices?.getUserMedia
  );
}

async function transcribeClip(
  organizationId: string,
  clip: Blob,
  signal: AbortSignal,
) {
  const response = await fetch(
    `/api/intelligence/transcription/segment?organizationId=${encodeURIComponent(organizationId)}`,
    {
      method: "POST",
      headers: { "Content-Type": clip.type },
      body: clip,
      signal,
    },
  );
  const json = (await response.json().catch(() => null)) as {
    text?: string;
    error?: { message?: string };
  } | null;
  if (!response.ok || typeof json?.text !== "string")
    throw new Error(
      json?.error?.message ??
        "Voice input could not transcribe what you said. What was transcribed is kept.",
    );
  return json.text;
}

function micError(error: unknown) {
  const name = error instanceof DOMException ? error.name : "";
  if (name === "NotAllowedError" || name === "SecurityError")
    return "Microphone access is blocked. Allow it in your browser's site settings to dictate.";
  if (name === "NotFoundError" || name === "OverconstrainedError")
    return "No microphone was found. Connect one and try again.";
  if (name === "NotReadableError")
    return "The microphone is in use by another app.";
  return null;
}

async function requestSession(organizationId: string, signal: AbortSignal) {
  const response = await fetch("/api/intelligence/transcription", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ organizationId }),
    signal,
  });
  const json = (await response.json().catch(() => null)) as
    (Session & { error?: { message?: string } }) | null;
  if (!response.ok || !json?.token)
    throw new Error(
      json?.error?.message ?? "Voice input could not start. Try again.",
    );
  return json;
}

export function useDictation(
  organizationId: string | undefined,
  handlers: Handlers,
  mode: DictationMode = "realtime",
) {
  const [state, setState] = useState<DictationState>("idle");
  const [error, setError] = useState<string | null>(null);
  const latest = useRef(handlers);
  useEffect(() => {
    latest.current = handlers;
  });
  const run = useRef<Run | null>(null);

  const end = useCallback((reason: "done" | "cancelled" | "error") => {
    const r = run.current;
    if (!r || r.ended) return;
    r.ended = true;
    run.current = null;
    r.abort.abort();
    r.recorder?.cancel();
    r.timers.forEach(clearTimeout);
    r.mic?.getTracks().forEach((t) => t.stop());
    r.channel?.close();
    r.pc?.close();
    setState("idle");
    latest.current.onEnd(reason);
  }, []);

  const fail = useCallback(
    (message: string) => {
      setError(message);
      end("error");
    },
    [end],
  );

  const start = useCallback(async () => {
    if (run.current || !organizationId) return;
    if (!dictationSupported(mode)) {
      setError("This browser does not support voice input.");
      return;
    }
    const r: Run = {
      abort: new AbortController(),
      spoken: "",
      timers: [],
      stopping: false,
      ended: false,
    };
    run.current = r;
    setError(null);
    setState("connecting");
    try {
      // Ask for the microphone first so the permission prompt cannot outlive
      // the short-lived credential.
      r.mic = await navigator.mediaDevices.getUserMedia({
        audio: {
          echoCancellation: true,
          noiseSuppression: true,
          autoGainControl: true,
        },
      });
      if (r.ended) return r.mic.getTracks().forEach((t) => t.stop());
      if (mode === "segments") {
        r.recorder = recordSegments(r.mic, {
          transcribe: (clip) =>
            transcribeClip(organizationId, clip, r.abort.signal),
          onText: (spoken) => {
            if (run.current !== r) return;
            r.spoken = spoken;
            latest.current.onText(spoken, false);
          },
          onError: (e) => {
            if (run.current === r)
              fail(e instanceof Error ? e.message : "Voice input stopped.");
          },
        });
        setState("listening");
        return;
      }
      const session = await requestSession(organizationId, r.abort.signal);

      const pc = new RTCPeerConnection();
      r.pc = pc;
      for (const track of r.mic.getAudioTracks()) pc.addTrack(track, r.mic);
      const channel = pc.createDataChannel("oai-events");
      r.channel = channel;
      channel.addEventListener("open", () => {
        if (run.current === r) setState("listening");
      });
      channel.addEventListener("message", ({ data }) => {
        if (run.current !== r) return;
        let event: {
          type?: string;
          item_id?: string;
          delta?: string;
          transcript?: string;
          error?: { message?: string };
        };
        try {
          event = JSON.parse(String(data)) as typeof event;
        } catch {
          return;
        }
        const transcript = event.type?.startsWith(
          "conversation.item.input_audio_transcription.",
        );
        if (transcript && event.item_id) {
          r.item ??= event.item_id;
          if (event.item_id !== r.item) return;
        }
        if (
          event.type === "conversation.item.input_audio_transcription.delta"
        ) {
          r.spoken += event.delta ?? "";
          latest.current.onText(r.spoken, false);
        } else if (
          event.type === "conversation.item.input_audio_transcription.completed"
        ) {
          latest.current.onText(event.transcript ?? r.spoken, true);
          end("done");
        } else if (event.type === "error") {
          // Committing silence is rejected; that just means nothing was said.
          if (r.stopping) {
            latest.current.onText(r.spoken, true);
            end("done");
          } else
            fail(
              event.error?.message
                ? `Voice input stopped: ${event.error.message}`
                : "Voice input stopped unexpectedly.",
            );
        }
      });
      pc.addEventListener("connectionstatechange", () => {
        if (run.current !== r) return;
        if (
          pc.connectionState === "failed" ||
          pc.connectionState === "disconnected"
        )
          fail(
            "Voice input lost its connection. What was transcribed is kept.",
          );
      });

      const offer = await pc.createOffer();
      await pc.setLocalDescription(offer);
      const answer = await fetch(session.callsUrl, {
        method: "POST",
        body: offer.sdp,
        headers: {
          Authorization: `Bearer ${session.token}`,
          "Content-Type": "application/sdp",
        },
        signal: r.abort.signal,
      });
      if (!answer.ok)
        throw new Error(
          `The speech-to-text provider rejected the connection (HTTP ${answer.status}).`,
        );
      if (r.ended) return;
      await pc.setRemoteDescription({
        type: "answer",
        sdp: await answer.text(),
      });
    } catch (e) {
      if (r.ended) return;
      fail(
        micError(e) ??
          (e instanceof Error ? e.message : "Voice input could not start."),
      );
    }
  }, [organizationId, end, fail, mode]);

  // Finish: let the last audio arrive, commit, release the microphone right
  // away, and wait for the provider's final transcript.
  const stop = useCallback(() => {
    const r = run.current;
    if (!r) return;
    if (r.recorder) {
      if (r.stopping) return;
      r.stopping = true;
      setState("finishing");
      // The last clip is sent now; the words arrive once it is transcribed.
      r.mic?.getTracks().forEach((t) => t.stop());
      void r.recorder.finish().then(() => {
        if (r.ended) return;
        latest.current.onText(r.spoken, true);
        end("done");
      });
      return;
    }
    if (r.channel?.readyState !== "open") return end("cancelled");
    if (r.stopping) return;
    r.stopping = true;
    setState("finishing");
    r.timers.push(
      setTimeout(() => {
        if (r.ended) return;
        r.channel?.send(JSON.stringify({ type: "input_audio_buffer.commit" }));
        r.mic?.getTracks().forEach((t) => t.stop());
      }, TAIL_MS),
      setTimeout(() => {
        if (r.ended) return;
        latest.current.onText(r.spoken, true);
        end("done");
      }, FINAL_TIMEOUT_MS),
    );
  }, [end]);

  const cancel = useCallback(() => end("cancelled"), [end]);

  useEffect(() => () => end("cancelled"), [end]);

  return {
    state,
    error,
    clearError: useCallback(() => setError(null), []),
    start,
    stop,
    cancel,
  };
}
