"use client";

import { Camera, TriangleAlert } from "@/components/ui/icons";
import * as React from "react";

export type ComposerCameraHandle = {
  capture: () => void;
};

export const ComposerCamera = React.forwardRef<
  ComposerCameraHandle,
  {
    active: boolean;
    onCapture: (file: File) => void;
  }
>(function ComposerCamera({ active, onCapture }, ref) {
  const videoRef = React.useRef<HTMLVideoElement>(null);
  const streamRef = React.useRef<MediaStream | null>(null);
  const onCaptureRef = React.useRef(onCapture);
  const [error, setError] = React.useState<string | null>(null);

  React.useEffect(() => {
    onCaptureRef.current = onCapture;
  }, [onCapture]);

  const stop = React.useCallback(() => {
    streamRef.current?.getTracks().forEach((track) => track.stop());
    streamRef.current = null;
  }, []);

  React.useEffect(() => {
    if (!active) {
      stop();
      return;
    }

    let cancelled = false;
    void navigator.mediaDevices
      .getUserMedia({
        video: { facingMode: "environment", width: { ideal: 1920 } },
        audio: false,
      })
      .then(async (stream) => {
        if (cancelled) {
          stream.getTracks().forEach((track) => track.stop());
          return;
        }
        streamRef.current = stream;
        if (videoRef.current) {
          videoRef.current.srcObject = stream;
          await videoRef.current.play().catch(() => undefined);
        }
      })
      .catch(() => {
        if (!cancelled) {
          setError(
            "Camera access is blocked. You can still add a photo from Files.",
          );
        }
      });

    return () => {
      cancelled = true;
      stop();
    };
  }, [active, stop]);

  React.useImperativeHandle(ref, () => ({
    capture() {
      const video = videoRef.current;
      if (!video || video.videoWidth === 0) return;
      const canvas = document.createElement("canvas");
      canvas.width = video.videoWidth;
      canvas.height = video.videoHeight;
      const context = canvas.getContext("2d");
      if (!context) return;
      context.drawImage(video, 0, 0);
      canvas.toBlob(
        (blob) => {
          if (!blob) return;
          onCaptureRef.current(
            new File(
              [blob],
              `photo-${new Date().toISOString().slice(0, 19).replace(/[:T]/g, "-")}.jpg`,
              { type: "image/jpeg" },
            ),
          );
        },
        "image/jpeg",
        0.92,
      );
    },
  }));

  if (!active) return null;

  return error ? (
    <div className="flex size-full flex-col items-center justify-center gap-3 px-8 text-center text-sm text-muted">
      <TriangleAlert className="size-5 text-warning" />
      {error}
    </div>
  ) : (
    <div className="relative size-full bg-black">
      <video
        ref={videoRef}
        muted
        playsInline
        className="size-full object-cover"
      />
      <div className="pointer-events-none absolute inset-4 rounded-lg border border-white/25" />
      <div className="pointer-events-none absolute left-1/2 top-5 flex -translate-x-1/2 items-center gap-2 rounded-full bg-black/45 px-3 py-1.5 text-xs text-white backdrop-blur-md">
        <Camera className="size-3.5" /> Camera
      </div>
    </div>
  );
});
