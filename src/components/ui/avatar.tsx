"use client";

import {
  createContext,
  useContext,
  useMemo,
  useState,
  type ReactNode,
} from "react";
import { IntelligenceMark } from "~/components/logo";
import { cn } from "~/lib/utils";
import { initials } from "~/lib/work-items";
import { safeProfileImage } from "~/profile/photo";
import { AI_ACTOR_NAME } from "~/sync/shared/ai";

const Images = createContext<ReadonlyMap<string, string | null | undefined>>(
  new Map(),
);

export function AvatarImages({
  members,
  children,
}: {
  members: { id: string; image?: string | null }[];
  children: ReactNode;
}) {
  const images = useMemo(
    () => new Map(members.map((m) => [m.id, m.image])),
    [members],
  );
  return <Images.Provider value={images}>{children}</Images.Provider>;
}

export function Avatar({
  name,
  userId,
  image,
  preview = false,
  size = "sm",
  className,
}: {
  name: string;
  userId?: string | null;
  image?: string | null;
  preview?: boolean;
  size?: "xs" | "sm" | "md" | "lg";
  className?: string;
}) {
  const images = useContext(Images);
  const raw = image === undefined && userId ? images.get(userId) : image;
  const src = preview && raw?.startsWith("blob:") ? raw : safeProfileImage(raw);
  const [failed, setFailed] = useState<string | null>(null);
  const intelligence = name === AI_ACTOR_NAME;
  return (
    <span
      title={name}
      aria-label={name}
      className={cn(
        "relative inline-grid shrink-0 place-items-center overflow-hidden rounded-full bg-secondary font-semibold text-secondary-foreground",
        size === "xs" && "size-4 text-[8px]",
        size === "sm" && "size-5 text-[9px]",
        size === "md" && "size-6 text-[10px]",
        size === "lg" && "size-16 text-xl",
        intelligence && "bg-primary/10 text-primary",
        className,
      )}
    >
      {intelligence ? (
        <IntelligenceMark className="size-[62%]" />
      ) : (
        initials(name)
      )}
      {!intelligence && src && failed !== src && (
        // Provider photos and private authenticated images cannot use the
        // public Next image optimizer. Keep initials underneath while loading.
        // eslint-disable-next-line @next/next/no-img-element
        <img
          key={src}
          src={src}
          alt=""
          referrerPolicy="no-referrer"
          onError={() => setFailed(src)}
          className="absolute inset-0 size-full rounded-full object-cover outline-1 -outline-offset-1 outline-black/10 dark:outline-white/10"
        />
      )}
    </span>
  );
}
