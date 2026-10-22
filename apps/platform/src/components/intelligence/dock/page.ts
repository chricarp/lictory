// Where the person is, read from the workspace route, for the Intelligence
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
  | "project-settings";

const labels: Record<PageKind, string> = {
  home: "Home",
  intelligence: "Lictory Intelligence",
  inbox: "Inbox",
  settings: "Organization settings",
  account: "Account settings",
  project: "Project",
  epics: "Epics",
  items: "Work items",
  item: "Work item",
  board: "Board",
  backlog: "Backlog",
  iteration: "Iteration",
  team: "Team",
  reviews: "Needs my review",
  view: "Saved view",
  handoff: "Hand-off",
  "project-settings": "Project settings",
};

export function pageOf(pathname: string): { kind: PageKind; label: string } {
  // /{org}/{first}/{second}/{third}
  const [, first, second, third] = pathname.split("/").filter(Boolean);
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
      case "views":
        return "view";
      case "settings":
        return "project-settings";
      default:
        return "project";
    }
  })();
  return { kind, label: labels[kind] };
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
