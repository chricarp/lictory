"use client";

import { useEffect, useRef, useState, useSyncExternalStore } from "react";
import { useRouter } from "next/navigation";
import { Camera } from "lucide-react";
import { Avatar } from "@lictory/ui/primitives";
import { Button } from "@lictory/ui/button";
import { InlineError } from "@lictory/platform/components/workspace/settings-section";
import { authClient } from "@lictory/platform/lib/auth-client";
import { ACCEPT_PROFILE_PHOTO, MAX_PROFILE_PHOTO_SIZE } from "@lictory/core/profile/photo";

const subscribe = () => () => undefined;
const clientReady = () => true;
const serverReady = () => false;

export function ProfilePhoto({
  name,
  image,
}: {
  name: string;
  image: string | null;
}) {
  const router = useRouter();
  // Do not accept a selection before React has attached the change handler.
  const ready = useSyncExternalStore(subscribe, clientReady, serverReady);
  const input = useRef<HTMLInputElement>(null);
  const [file, setFile] = useState<File | null>(null);
  const [preview, setPreview] = useState<string | null>(null);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  useEffect(
    () => () => {
      if (preview) URL.revokeObjectURL(preview);
    },
    [preview],
  );

  function cancel() {
    setFile(null);
    setPreview(null);
    if (input.current) input.current.value = "";
  }

  async function save(remove = false) {
    if (pending || (!remove && !file)) return;
    setPending(true);
    setError(null);
    setMessage(null);
    try {
      const response = await fetch("/api/profile/photo", {
        method: remove ? "DELETE" : "PUT",
        ...(remove
          ? {}
          : { body: file, headers: { "Content-Type": file!.type } }),
      });
      const result = (await response.json()) as { error?: string };
      if (!response.ok)
        throw new Error(
          result.error ?? "Your photo could not be saved. Try again.",
        );
      cancel();
      setMessage(
        remove
          ? "Photo removed. Your initials will be shown."
          : "Profile photo updated.",
      );
      await authClient.getSession({ query: { disableCookieCache: true } });
      router.refresh();
    } catch (e) {
      setError(
        e instanceof Error
          ? e.message
          : "Your photo could not be saved. Try again.",
      );
    } finally {
      setPending(false);
    }
  }

  return (
    <div className="space-y-3">
      <div className="flex items-center gap-4">
        <Avatar
          name={name}
          image={file ? preview : image}
          preview={!!file}
          size="lg"
        />
        <div className="min-w-0 space-y-2">
          <p className="text-[13px] font-medium">Profile photo</p>
          <div className="flex flex-wrap gap-2">
            <Button
              type="button"
              variant="secondary"
              disabled={!ready || pending}
              onClick={() => input.current?.click()}
            >
              <Camera aria-hidden className="size-3.5" />
              {image || file ? "Change photo" : "Upload photo"}
            </Button>
            {image && !file && (
              <Button
                type="button"
                variant="ghost"
                disabled={!ready || pending}
                onClick={() => void save(true)}
              >
                Remove photo
              </Button>
            )}
          </div>
          <p id="profile-photo-hint" className="text-xs text-muted-foreground">
            JPEG, PNG or WebP · up to 4 MB. Cropped to a square.
          </p>
        </div>
      </div>
      <input
        ref={input}
        type="file"
        aria-label="Choose profile photo"
        aria-describedby="profile-photo-hint"
        accept={ACCEPT_PROFILE_PHOTO}
        className="sr-only"
        disabled={!ready || pending}
        tabIndex={-1}
        onChange={(event) => {
          const selected = event.target.files?.[0];
          if (!selected) return;
          setMessage(null);
          setError(null);
          if (
            !ACCEPT_PROFILE_PHOTO.split(",").includes(selected.type) ||
            selected.size > MAX_PROFILE_PHOTO_SIZE
          ) {
            setError("Choose a JPEG, PNG or WebP photo smaller than 4 MB.");
            event.target.value = "";
            return;
          }
          setFile(selected);
          setPreview(URL.createObjectURL(selected));
        }}
      />
      {file && (
        <div className="flex flex-wrap items-center gap-2">
          <Button type="button" disabled={pending} onClick={() => void save()}>
            {pending ? "Saving…" : "Save photo"}
          </Button>
          <Button
            type="button"
            variant="ghost"
            disabled={pending}
            onClick={cancel}
          >
            Cancel
          </Button>
          <span className="text-xs text-muted-foreground">
            Preview · not saved yet
          </span>
        </div>
      )}
      {pending && !file && (
        <p role="status" className="text-xs text-muted-foreground">
          Removing photo…
        </p>
      )}
      {error && <InlineError>{error}</InlineError>}
      {message && (
        <p
          role="status"
          className="text-xs text-emerald-700 dark:text-emerald-400"
        >
          {message}
        </p>
      )}
    </div>
  );
}
