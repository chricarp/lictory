import type { ComponentType, ReactNode } from "react";
import { homeSection } from "@lictory/platform/components/shell/sections/home";
import { inboxSection } from "@lictory/platform/components/shell/sections/inbox";
import { projectsSection } from "@lictory/platform/components/shell/sections/projects";
import { spacesSection } from "@lictory/platform/components/shell/sections/spaces";
import {
  channelsPalette,
  channelsSection,
  directMessagesSection,
} from "@lictory/platform/components/channels/nav";
import {
  factoryPalette,
  factorySection,
} from "@lictory/platform/components/factory/nav";
import { agentHomeCards } from "@lictory/platform/components/shell/home/agent-cards";
import { codeSection } from "@lictory/platform/components/code/code-nav";

// The navigation registry: what each module contributes to the shell. A
// module adds itself by exporting a definition and listing it here; replacing
// a placeholder is changing its import. The lists are static on purpose:
// their order is the order people see, and hooks the shell calls for each
// entry (`useBadge`, `useEntries`) run in a stable order on every render.

// A count shown beside a section in the sidebar.
export type NavBadge = {
  // 0 with a `dot` shows the dot alone.
  count: number;
  // What the number counts, read by assistive technology after the section's
  // name: "unread mentions", "to do".
  label: string;
  // "strong" is addressed to me (mentions, direct messages, requests); a
  // "quiet" count is activity worth a glance.
  tone: "strong" | "quiet";
  // Counts toward the desktop app's dock or taskbar badge. Only mentions and
  // direct messages do (the desktop contract); the shell adds them to the
  // desktop bridge as one source (lib/desktop-bridge.ts).
  dock?: boolean;
  // A quiet dot after the count for lesser news, named for assistive
  // technology: the Inbox counts what waits on me and dots unread updates.
  dot?: string;
};

export type NavSectionProps = {
  // The section's own badge (from `useBadge`), for the section to place.
  badge: NavBadge | null;
};

export type NavSection = {
  id: string;
  // The module's name, as in "Go to Channels" in the command palette.
  label: string;
  icon: ComponentType<{ className?: string }>;
  // The module's own page.
  href: (org: string) => string;
  // Read on every render of the shell; must be cheap (a Zero query, a
  // counter). Return null for no badge.
  useBadge?: () => NavBadge | null;
  // The section in the sidebar, built from `SidebarGroup` and `SidebarLink`
  // (`components/shell/sidebar-parts`), which also draw the compact sidebar.
  Section: ComponentType<NavSectionProps>;
};

// Sidebar order: Home, Inbox, Channels, Direct messages, Factory, Code,
// Projects, Spaces. Account and settings sit below them.
export const navSections: readonly NavSection[] = [
  homeSection,
  inboxSection,
  channelsSection,
  directMessagesSection,
  factorySection,
  codeSection,
  projectsSection,
  spacesSection,
];

// One result in the command palette.
export type PaletteEntry = {
  id: string;
  label: string;
  // Right-aligned detail: a key, a space, a project.
  hint?: string;
  // A state after the hint, as a `StatusChip` ("Waiting on you").
  chip?: ReactNode;
  icon?: ReactNode;
  // Extra words that match (synonyms, the module's name).
  keywords?: string;
} & ({ href: string; run?: never } | { run: () => void; href?: never });

export type PaletteProvider = {
  id: string;
  // The group heading the entries appear under.
  group: string;
  // Called while the palette is open, with the trimmed query ("" before
  // typing). Return candidates; the palette matches them against the query
  // by label and keywords, ranks them and shows at most a few. With an empty
  // query only the first three are shown, so return what is worth jumping
  // to first (recent, unread) at the front.
  useEntries: (query: string) => readonly PaletteEntry[];
};

// Conversations, then agent sessions and agents.
export const paletteProviders: readonly PaletteProvider[] = [
  channelsPalette,
  factoryPalette,
];

export type HomeCard = {
  id: string;
  // Names the card when it fails to render.
  label: string;
  // A card on Home. It renders nothing until it has something to show, so a
  // module without data (no agents yet) leaves no empty box. Use `Panel`
  // and `ListRow` (`components/shell/panel`, `components/shell/list-row`);
  // a `Panel` without rows and without `empty` renders nothing by itself.
  Card: ComponentType;
};

// The factory floor: what agents ask me, then the sessions at work.
export const homeCards: readonly HomeCard[] = [...agentHomeCards];
