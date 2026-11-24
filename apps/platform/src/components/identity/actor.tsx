import { useMemo, useState, type CSSProperties, type ReactNode } from "react";
import { Bot, Workflow } from "lucide-react";
import { cn } from "@lictory/core/lib/utils";
import { initials } from "@lictory/core/lib/work-items";
import { safeProfileImage } from "@lictory/core/profile/photo";
import { Tooltip } from "@lictory/ui/tooltip";
import { useWorkspace } from "@lictory/platform/components/workspace/provider";
import { identityColor } from "@lictory/platform/components/identity/color";
import { SlackMark } from "@lictory/platform/components/identity/slack-mark";
import { firstName } from "@lictory/platform/lib/session-state";

// Who did something, drawn the same way everywhere: people as circles in
// their own color (their photo when they have one), agents as rounded
// squares with a small robot badge, always named with the person they act
// for, and automated acts as the policy and the person who set it.

// Rendered sizes, in pixels. 16 is the smallest: below 20 a person's
// initials would be unreadable, so their avatar is a plain colored dot named
// by its tooltip. An agent's square keeps its one letter or emoji.
export type ActorSize = 16 | 20 | 24 | 32 | 36;

const text: Record<ActorSize, string> = {
  16: "",
  20: "text-[9.5px]",
  24: "text-[10.5px]",
  32: "text-xs",
  36: "text-[13px]",
};

export type Person = {
  id: string;
  name: string;
  image?: string | null;
  // Someone outside Lictory, seen through an integration.
  external?: "slack";
};

// The people of the organization by id, with their photos.
export function usePerson(userId: string | null | undefined): Person {
  const { directory, memberName } = useWorkspace();
  return useMemo(() => {
    const member = userId
      ? directory.members.find((m) => m.id === userId)
      : undefined;
    return {
      id: userId ?? "unknown",
      name: memberName(userId),
      image: member?.image ?? null,
    };
  }, [directory.members, memberName, userId]);
}

function Img({ src, className }: { src: string; className?: string }) {
  const [failed, setFailed] = useState(false);
  if (failed) return null;
  return (
    <img
      src={src}
      alt=""
      referrerPolicy="no-referrer"
      onError={() => setFailed(true)}
      className={cn(
        "absolute inset-0 size-full object-cover outline-1 -outline-offset-1 outline-black/10 dark:outline-white/10",
        className,
      )}
    />
  );
}

// A person's avatar: their photo, else their initials on their color. Named
// by `aria-label`, so the initials never join a surrounding control's name.
export function PersonAvatar({
  person,
  size = 20,
  className,
  // Draw a ring in the surface color (facepiles, avatars over a corner).
  ring = false,
}: {
  person: Person;
  size?: ActorSize;
  className?: string;
  ring?: boolean;
}) {
  const src = safeProfileImage(person.image);
  const color = identityColor(person.external ? person.name : person.id);
  const dot = size < 20;
  const avatar = (
    <span
      role="img"
      aria-label={person.name}
      data-actor="person"
      style={{ width: size, height: size, background: color }}
      className={cn(
        "relative inline-grid shrink-0 place-items-center overflow-visible rounded-full leading-none font-semibold text-white select-none",
        text[size],
        ring && "ring-2 ring-(--actor-ring,var(--background))",
        className,
      )}
    >
      <span className="absolute inset-0 overflow-hidden rounded-full">
        {!dot && !src && (
          <span
            aria-hidden
            className="grid size-full place-items-center before:content-[attr(data-initials)]"
            data-initials={initials(person.name)}
          />
        )}
        {src && <Img src={src} className="rounded-full" />}
      </span>
      {person.external === "slack" && size >= 20 && (
        <CornerBadge size={size} label="Slack">
          <SlackMark className="size-[70%] text-foreground" />
        </CornerBadge>
      )}
    </span>
  );
  // A dot has no initials to read, so it says who it is on hover.
  return dot ? <Tooltip label={person.name}>{avatar}</Tooltip> : avatar;
}

function CornerBadge({
  size,
  label,
  children,
}: {
  size: ActorSize;
  label: string;
  children: ReactNode;
}) {
  const badge = Math.max(10, Math.round(size * 0.45));
  return (
    <span
      aria-hidden
      title={label}
      style={{ width: badge, height: badge }}
      className="absolute -right-1 -bottom-1 grid place-items-center rounded-full bg-card text-foreground shadow-[0_0_0_1.5px_var(--actor-ring,var(--background))]"
    >
      {children}
    </span>
  );
}

export type AgentIdentity = {
  id: string;
  name: string;
  // An emoji or up to four characters the owner chose.
  avatar?: string | null;
};

// An agent's avatar: a rounded square in the agent's color with its emoji
// (or its initial), and a robot in the corner from 24px up.
export function AgentAvatar({
  agent,
  size = 20,
  className,
  ring = false,
}: {
  agent: AgentIdentity;
  size?: ActorSize;
  className?: string;
  ring?: boolean;
}) {
  const color = identityColor(`agent:${agent.id}`);
  const mark = agent.avatar?.trim();
  const style: CSSProperties = {
    width: size,
    height: size,
    background: `color-mix(in oklab, ${color} 16%, var(--card))`,
    color: `color-mix(in oklab, ${color} 85%, var(--foreground))`,
    boxShadow: `inset 0 0 0 1px color-mix(in oklab, ${color} 30%, transparent)`,
  };
  const avatar = (
    <span
      role="img"
      aria-label={`${agent.name} (agent)`}
      data-actor="agent"
      style={style}
      className={cn(
        "relative inline-grid shrink-0 place-items-center rounded-[28%] leading-none font-semibold select-none",
        size === 16 ? "text-[8.5px]" : text[size],
        size >= 32 && "text-base",
        ring && "ring-2 ring-(--actor-ring,var(--background))",
        className,
      )}
    >
      {/* Never a blank square: the agent's emoji, else its initial, at
          every size. */}
      {mark ? (
        <span
          aria-hidden
          className={
            size >= 32 ? "text-base" : size >= 20 ? "text-xs" : "text-[10px]"
          }
        >
          {mark}
        </span>
      ) : (
        <span aria-hidden>{agent.name.slice(0, 1).toUpperCase()}</span>
      )}
      {/* Below 24px the badge would be an unreadable blob: the shape and
          "via" the owner say "agent" there. */}
      {size >= 24 && (
        <CornerBadge size={size} label="Agent">
          <Bot className="size-[75%]" strokeWidth={2.25} />
        </CornerBadge>
      )}
    </span>
  );
  return size < 20 ? <Tooltip label={agent.name}>{avatar}</Tooltip> : avatar;
}

// An avatar and a name. `label` "first" names people by first name (with
// the full name on hover), "none" shows only the avatar.
export function Actor({
  person,
  userId,
  size = 20,
  label = "full",
  className,
}: {
  person?: Person;
  // Or a member of the organization, looked up by id.
  userId?: string | null;
  size?: ActorSize;
  label?: "full" | "first" | "none";
  className?: string;
}) {
  const member = usePerson(userId);
  const who = person ?? member;
  const avatar = <PersonAvatar person={who} size={size} />;
  if (label === "none") return avatar;
  return (
    <span className={cn("inline-flex min-w-0 items-center gap-1.5", className)}>
      {avatar}
      {label === "first" ? (
        <Tooltip label={who.name}>
          <span className="truncate">{firstName(who.name)}</span>
        </Tooltip>
      ) : (
        <span className="truncate">{who.name}</span>
      )}
    </span>
  );
}

// "Forge via Ada": an agent always acts for its owner. The agent's name
// never truncates; the owner is a first name with the full name on hover.
export function AgentActor({
  agent,
  owner,
  ownerId,
  size = 20,
  avatar = true,
  className,
}: {
  agent: AgentIdentity | undefined;
  // The accountable person, or their id.
  owner?: Person;
  ownerId?: string | null;
  size?: ActorSize;
  avatar?: boolean;
  className?: string;
}) {
  const member = usePerson(ownerId);
  const person = owner ?? member;
  if (!agent)
    return <span className="text-muted-foreground">Unknown agent</span>;
  return (
    <span
      data-agent-actor
      className={cn("inline-flex min-w-0 items-center gap-1.5", className)}
    >
      {avatar && <AgentAvatar agent={agent} size={size} />}
      <span className="shrink-0 font-medium text-foreground">{agent.name}</span>
      {/* Read as words ("Forge via Ada"); a flex gap draws the space. */}{" "}
      <Tooltip label={`Acts for ${person.name}`}>
        <span className="min-w-0 truncate text-muted-foreground">
          via {firstName(person.name)}
        </span>
      </Tooltip>
    </span>
  );
}

const policyNames: Record<string, string> = {
  assist: "Assist policy",
  build: "Build policy",
  autopilot: "Autopilot policy",
};

// What a project's autonomy policy did by itself, attributed to the policy
// and the person who set it: "Build policy (set by Ada)".
export function PolicyActor({
  level,
  setBy,
  setById,
  size = 20,
  className,
}: {
  level: "assist" | "build" | "autopilot";
  setBy?: Person;
  setById?: string | null;
  size?: ActorSize;
  className?: string;
}) {
  const member = usePerson(setById);
  const person = setBy ?? member;
  return (
    <span
      data-policy-actor
      className={cn("inline-flex min-w-0 items-center gap-1.5", className)}
    >
      <span
        aria-hidden
        style={{ width: size, height: size }}
        className="grid shrink-0 place-items-center rounded-[28%] bg-muted text-muted-foreground ring-1 ring-foreground/10 ring-inset"
      >
        <Workflow className="size-[62%]" />
      </span>
      <span className="shrink-0 font-medium text-foreground">
        {policyNames[level]}
      </span>{" "}
      <Tooltip label={`Set by ${person.name}`}>
        <span className="min-w-0 truncate text-muted-foreground">
          (set by {firstName(person.name)})
        </span>
      </Tooltip>
    </span>
  );
}

// Overlapping avatars that never clip each other's initials: each sits on a
// ring in the surface color, and the overflow is a count. Pass the surface
// as `--actor-ring` when it is not the page background.
export function Facepile({
  people,
  max = 4,
  size = 20,
  label,
  className,
}: {
  people: readonly (Person | (AgentIdentity & { agent: true }))[];
  max?: number;
  size?: ActorSize;
  // Names the group: "4 members".
  label?: string;
  className?: string;
}) {
  const shown = people.slice(0, people.length > max ? max - 1 : max);
  const rest = people.length - shown.length;
  return (
    <span
      role="group"
      aria-label={label ?? `${people.length} people`}
      className={cn("inline-flex items-center", className)}
      style={{ gap: 0 }}
    >
      {shown.map((p, i) => (
        <span
          key={p.id}
          className="relative inline-flex"
          style={{ marginLeft: i === 0 ? 0 : -Math.round(size * 0.25) }}
        >
          {"agent" in p ? (
            <AgentAvatar agent={p} size={size} ring />
          ) : (
            <PersonAvatar person={p} size={size} ring />
          )}
        </span>
      ))}
      {rest > 0 && (
        <span
          aria-label={`and ${rest} more`}
          role="img"
          style={{
            height: size,
            minWidth: size,
            marginLeft: -Math.round(size * 0.25),
          }}
          className={cn(
            "relative inline-grid place-items-center rounded-full bg-muted px-1 font-semibold text-muted-foreground tabular-nums ring-2 ring-(--actor-ring,var(--background))",
            text[size === 16 ? 20 : size],
          )}
        >
          +{rest}
        </span>
      )}
    </span>
  );
}
