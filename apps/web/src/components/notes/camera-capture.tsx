"use client";

import { AnimatePresence, motion } from "motion/react";
import { Camera, Check, RefreshCw, RotateCw, X } from "@/components/ui/icons";
import * as React from "react";

import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";

export type CameraCaptureProps = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onCapture: (file: File) => void;
};

/** In-app photo capture, so a receipt or whiteboard never needs a round trip
 *  through the camera roll. */
export function CameraCapture({
  open,
  onOpenChange,
  onCapture,
}: CameraCaptureProps) {
  const videoRef = React.useRef<HTMLVideoElement>(null);
  const streamRef = React.useRef<MediaStream | null>(null);
  const [facing, setFacing] = React.useState<"user" | "environment">(
    "environment",
  );
  const [shot, setShot] = React.useState<{ url: string; file: File } | null>(
    null,
  );
  const [error, setError] = React.useState<string | null>(null);
  const [flash, setFlash] = React.useState(false);

  const stop = React.useCallback(() => {
    streamRef.current?.getTracks().forEach((track) => track.stop());
    streamRef.current = null;
  }, []);

  React.useEffect(() => {
    if (!open || shot) return;
    let cancelled = false;

    (async () => {
      setError(null);
      try {
        const stream = await navigator.mediaDevices.getUserMedia({
          video: { facingMode: facing, width: { ideal: 1920 } },
          audio: false,
        });
        if (cancelled) {
          stream.getTracks().forEach((track) => track.stop());
          return;
        }
        streamRef.current = stream;
        if (videoRef.current) {
          videoRef.current.srcObject = stream;
          await videoRef.current.play().catch(() => undefined);
        }
      } catch {
        setError(
          "Camera access was blocked. Enable it in your browser settings, or upload a photo instead.",
        );
      }
    })();

    return () => {
      cancelled = true;
      stop();
    };
  }, [open, facing, shot, stop]);

  // Closing the dialog discards any unsaved shot. Handled during render so the
  // preview cannot linger for a frame when the dialog is reopened.
  const [session, setSession] = React.useState(open);
  if (session !== open) {
    setSession(open);
    if (!open && shot) {
      URL.revokeObjectURL(shot.url);
      setShot(null);
    }
  }

  React.useEffect(() => {
    if (!open) stop();
  }, [open, stop]);

  const capture = () => {
    const video = videoRef.current;
    if (!video) return;
    const canvas = document.createElement("canvas");
    canvas.width = video.videoWidth;
    canvas.height = video.videoHeight;
    const context = canvas.getContext("2d");
    if (!context) return;
    context.drawImage(video, 0, 0);

    setFlash(true);
    setTimeout(() => setFlash(false), 180);

    canvas.toBlob(
      (blob) => {
        if (!blob) return;
        const file = new File(
          [blob],
          `photo-${new Date().toISOString().slice(0, 19).replace(/[:T]/g, "-")}.jpg`,
          { type: "image/jpeg" },
        );
        setShot({ url: URL.createObjectURL(blob), file });
        stop();
      },
      "image/jpeg",
      0.92,
    );
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-xl" showClose={false}>
        <DialogHeader className="flex-row items-center justify-between">
          <div>
            <DialogTitle>Take a photo</DialogTitle>
            <DialogDescription>
              It is attached to this note straight away.
            </DialogDescription>
          </div>
          <Button
            variant="ghost"
            size="icon-sm"
            onClick={() => onOpenChange(false)}
            aria-label="Close camera"
          >
            <X />
          </Button>
        </DialogHeader>

        <div className="relative aspect-[4/3] w-full overflow-hidden bg-black">
          {error ? (
            <div className="flex size-full items-center justify-center p-8 text-center text-sm text-muted">
              {error}
            </div>
          ) : shot ? (
            <motion.img
              key="shot"
              src={shot.url}
              alt="Captured photo preview"
              initial={{ opacity: 0, scale: 1.04 }}
              animate={{ opacity: 1, scale: 1 }}
              className="size-full object-cover"
            />
          ) : (
            <video
              ref={videoRef}
              playsInline
              muted
              className="size-full object-cover"
            />
          )}

          <AnimatePresence>
            {flash ? (
              <motion.span
                className="absolute inset-0 bg-white"
                initial={{ opacity: 0.9 }}
                animate={{ opacity: 0 }}
                exit={{ opacity: 0 }}
                transition={{ duration: 0.25 }}
              />
            ) : null}
          </AnimatePresence>
        </div>

        <div className="flex items-center justify-center gap-3 px-6 py-4">
          {shot ? (
            <>
              <Button
                variant="ghost"
                onClick={() => {
                  URL.revokeObjectURL(shot.url);
                  setShot(null);
                }}
              >
                <RefreshCw />
                Retake
              </Button>
              <Button
                variant="primary"
                onClick={() => {
                  onCapture(shot.file);
                  URL.revokeObjectURL(shot.url);
                  setShot(null);
                  onOpenChange(false);
                }}
              >
                <Check />
                Use photo
              </Button>
            </>
          ) : (
            <>
              <Button
                variant="ghost"
                size="icon"
                onClick={() =>
                  setFacing((current) =>
                    current === "user" ? "environment" : "user",
                  )
                }
                aria-label="Switch camera"
              >
                <RotateCw />
              </Button>
              <button
                type="button"
                onClick={capture}
                disabled={Boolean(error)}
                aria-label="Take photo"
                className="flex size-16 items-center justify-center rounded-full border-4 border-hairline-strong transition-colors hover:border-foreground disabled:opacity-40"
              >
                <span className="flex size-12 items-center justify-center rounded-full bg-ember">
                  <Camera className="size-5 text-white" />
                </span>
              </button>
              <span className="size-10" aria-hidden />
            </>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}
