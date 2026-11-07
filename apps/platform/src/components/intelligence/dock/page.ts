// Where the person is, read from the workspace route, for the Litto
// dock: the label it sends as context and the suggestions it offers there.

export type PageKind =
  | "home"
  | "intelligence"
  | "inbox"
  | "settings"
  | "account"
  | "project"
  | "epics"
  | "items"
  | "item"
  | "board"
  | "backlog"
  | "iteration"
  | "team"
  | "reviews"
  | "view"
  | "handoff"
  | "project-settings"
  // Lictory Spaces.
  | "spaces"
  | "space"
  | "space-page"
  | "page-history"
  | "space-pull-requests"
  | "space-settings";

const labels: Record<PageKind, string> = {
  home: "Home",
  intelligence: "Litto",
  inbox: "Inbox",
  settings: "Organization settings",
  account: "Account settings",
  project: "Project",
  epics: "All items",
  items: "All items",
  item: "Work item",
  board: "Board",
  backlog: "Backlog",
  iteration: "Iteration",
  team: "Team",
  reviews: "Needs my review",
  view: "Saved view",
  handoff: "Hand-off",
  "project-settings": "Project settings",
  spaces: "Spaces",
  space: "Space",
  "space-page": "Page",
  "page-history": "Page history",
  "space-pull-requests": "Pull requests",
  "space-settings": "Space settings",
};

// /{org}/spaces[/{space}[/pages/{page}[/history] | /pull-requests | /settings]]
function spacesPageOf(
  space: string | undefined,
  section: string | undefined,
  pageId: string | undefined,
  rest: string | undefined,
): { kind: PageKind; space?: string; pageId?: string } {
  if (!space) return { kind: "spaces" };
  if (section === "pages" && pageId)
    return {
      kind: rest === "history" ? "page-history" : "space-page",
      space,
      pageId,
    };
  if (section === "pull-requests")
    return { kind: "space-pull-requests", space };
  if (section === "settings") return { kind: "space-settings", space };
  return { kind: "space", space };
}

// A malformed escape in the address (typed or pasted by hand) must not
// throw while rendering; the raw segment then names the space.
function decodeSegment(segment: string): string {
  try {
    return decodeURIComponent(segment);
  } catch {
    return segment;
  }
}

export function pageOf(pathname: string): {
  kind: PageKind;
  label: string;
  // Lictory Spaces: the space's slug and the page's id in the address.
  space?: string;
  pageId?: string;
} {
  // /{org}/{first}/{second}/{third}
  const [, first, second, third, fourth, fifth] = pathname
    .split("/")
    .filter(Boolean);
  if (first === "spaces") {
    const found = spacesPageOf(
      second && decodeSegment(second),
      third,
      fourth,
      fifth,
    );
    return { ...found, label: labels[found.kind] };
  }
  const kind = ((): PageKind => {
    switch (first) {
      case undefined:
        return "home";
      case "intelligence":
      case "inbox":
      case "settings":
      case "account":
        return first;
      case "notifications":
        return "inbox";
      case "items":
        return second ? "item" : "home";
    }
    switch (second) {
      case undefined:
        return "project";
      case "epics":
        return third ? "item" : "epics";
      case "items":
      case "stories":
        return third ? "item" : "items";
      case "board":
      case "backlog":
      case "reviews":
      case "handoff":
        return second;
      case "iterations":
        return "iteration";
      case "teams":
        return "team";
      case "proposals":
      case "refinement":
      case "views":
        return "view";
      case "settings":
        return "project-settings";
      default:
        return "project";
    }
  })();
  return {
    kind,
    label:
      second === "proposals"
        ? "Proposals"
        : second === "refinement"
          ? "Refinement"
          : labels[kind],
  };
}

export type Suggestion = { label: string; prompt: string };

// Questions worth asking on each kind of page. The open item and a text
// selection have their own suggestions in the dock.
export function pageSuggestions(
  kind: PageKind,
  project: { key: string; name: string } | undefined,
): Suggestion[] {
  const where = project ? ` in ${project.key}` : "";
  switch (kind) {
    case "spaces":
      return [
        {
          label: "What is documented where?",
          prompt:
            "Which spaces can I read, and what does each one document? Point me to the pages worth reading first.",
        },
      ];
    case "space":
    case "space-settings":
      return [
        {
          label: "Summarize this space",
          prompt:
            "Summarize what this space documents and which of its pages changed recently.",
        },
        {
          label: "What looks out of date?",
          prompt:
            "Which pages in this space disagree with the agreed specifications or delivered work they mention?",
        },
      ];
    case "space-pull-requests":
      return [
        {
          label: "What needs review?",
          prompt:
            "Which page pull requests in this space wait for review, what does each change, and what blocks them?",
        },
      ];
    case "page-history":
      return [
        {
          label: "What changed recently?",
          prompt:
            "What changed on this page in its recent versions, who changed it, and why?",
        },
        {
          label: "Summarize open proposals",
          prompt:
            "Summarize the open branches and pull requests of this page: what they change and what blocks them.",
        },
      ];
    case "inbox":
      return [
        {
          label: "What needs me first?",
          prompt:
            "Of what is in my inbox, what should I handle first, and why?",
        },
        {
          label: "What am I blocking?",
          prompt: "Which reviews or decisions am I blocking for other people?",
        },
      ];
    case "board":
      return [
        {
          label: "What is at risk?",
          prompt: `What is at risk on this board${where}: stalled, blocked or not-ready work in progress?`,
        },
        {
          label: "Who is overloaded?",
          prompt: `Who has too much in progress${where} right now?`,
        },
      ];
    case "backlog":
      return [
        {
          label: "Plan the next iteration",
          prompt: `Help me plan the next iteration${where}: which top-ranked items are ready, and which need refinement first?`,
        },
        {
          label: "What is not ready?",
          prompt: `Which of the top items in the backlog${where} are not ready, and what is missing?`,
        },
      ];
    case "iteration":
      return [
        {
          label: "Summarize this iteration",
          prompt:
            "Summarize this iteration: progress, risks and blocked items.",
        },
      ];
    case "team":
      return [
        {
          label: "How is this team doing?",
          prompt:
            "How is this team doing: progress, review load and blocked work?",
        },
      ];
    case "reviews":
      return [
        {
          label: "What should I review first?",
          prompt:
            "What should I review first, and what is blocking each of these?",
        },
      ];
    case "handoff":
      return [
        {
          label: "What is ready to hand off?",
          prompt: `Which ready specifications${where} have not been handed off yet?`,
        },
      ];
    case "epics":
    case "items":
    case "view":
    case "project":
      return [
        {
          label: "What is not ready?",
          prompt: `Which items${where} are furthest from ready, and what is missing?`,
        },
        {
          label: "Find overlaps",
          prompt: `Are there duplicate or overlapping items${where}?`,
        },
      ];
    default:
      return [
        {
          label: "What needs my attention?",
          prompt: "What needs my attention today, and why?",
        },
        {
          label: "What is waiting on me?",
          prompt: "What is waiting for my review, and what is blocking it?",
        },
      ];
  }
}

// A page of Lictory Spaces: what it says, what to do with it, and how it
// compares with the agreed specifications of the work items it mentions.
export function spacePageSuggestions(page: {
  items: readonly { key: string }[];
}): Suggestion[] {
  return [
    {
      label: "Summarize this page",
      prompt:
        "Summarize this page: what it says, what it decides and what looks unclear or out of date.",
    },
    {
      label: "Draft proposals from this page",
      prompt:
        "Draft proposals from this page: read it and use it as source material, then let me choose which drafts to create.",
    },
    {
      label: "Which work items does this page mention?",
      prompt:
        "Which work items does this page mention, and where does each stand in refinement, readiness and delivery?",
    },
    ...page.items.slice(0, 2).map((item) => ({
      label: `Compare with ${item.key}`,
      prompt: `Compare this page with the agreed specification of ${item.key}: where do they disagree, and which one should change?`,
    })),
  ];
}

export const pageSelectionSuggestions: Suggestion[] = [
  {
    label: "What does this mean?",
    prompt:
      "What does this part of the page mean, in the context of the rest of the page?",
  },
  {
    label: "Does this match what was agreed?",
    prompt:
      "Does this part of the page match the agreed specifications and recorded decisions? Cite what you compared.",
  },
  {
    label: "Draft a proposal from this",
    prompt:
      "Draft a proposal from this part of the page: use it as the source, then let me decide whether to create it.",
  },
];
