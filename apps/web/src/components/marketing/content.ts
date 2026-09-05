/**
 * Everything the landing page says and shows lives here so the story can be
 * edited without touching layout or motion. The examples are deliberately
 * continuous: the same people, documents and places recur across sections so
 * the product feels like one memory rather than a set of unrelated mockups.
 */

export type FragmentKind =
  | "voice"
  | "text"
  | "photo"
  | "file"
  | "link"
  | "location"
  | "person"
  | "reminder";

export type ContextType =
  "person" | "place" | "time" | "topic" | "organization" | "note";

export type ContextTag = { type: ContextType; label: string };

export type Fragment = {
  id: string;
  kind: FragmentKind;
  title: string;
  body?: string;
  meta?: string;
  /** What Lictory understood about this fragment. */
  context: ContextTag[];
};

export const KIND_LABEL: Record<FragmentKind, string> = {
  voice: "Voice note",
  text: "Thought",
  photo: "Photo",
  file: "Document",
  link: "Link",
  location: "Location",
  person: "Person",
  reminder: "Reminder",
};

/* --------------------------------------------------------------------------
 * Hero
 * ------------------------------------------------------------------------ */

export const HERO_PROMPT = "Call Marco tomorrow morning about the apartment.";

export const HERO_FRAGMENTS: Fragment[] = [
  {
    id: "voice-marco",
    kind: "voice",
    title: "Voice note",
    body: "Remind me to call Marco tomorrow morning about the apartment.",
    meta: "0:06",
    context: [
      { type: "time", label: "Tomorrow · 09:00" },
      { type: "person", label: "Marco" },
    ],
  },
  {
    id: "place-ikea",
    kind: "location",
    title: "IKEA Roma Anagnina",
    body: "Buy the KALLAX inserts",
    context: [{ type: "place", label: "Near IKEA" }],
  },
  {
    id: "file-blood",
    kind: "file",
    title: "Blood Tests — February 2026.pdf",
    meta: "2 pages",
    context: [
      { type: "topic", label: "Health" },
      { type: "note", label: "Annual checkup" },
    ],
  },
  {
    id: "photo-receipt",
    kind: "photo",
    title: "Receipt",
    meta: "Trattoria da Nennella",
    context: [
      { type: "place", label: "Milan" },
      { type: "time", label: "March 18" },
    ],
  },
  {
    id: "thought-onboarding",
    kind: "text",
    title: "Thought",
    body: "Maybe onboarding should start with voice capture.",
    context: [{ type: "topic", label: "Project: Onboarding" }],
  },
];

/* --------------------------------------------------------------------------
 * Capture demo
 * ------------------------------------------------------------------------ */

export type CaptureMode = {
  id: FragmentKind;
  label: string;
  /** What the user puts in. */
  input: { title: string; body: string; meta?: string };
  /** What Lictory takes out of it. */
  understood: ContextTag[];
  summary: string;
};

export const CAPTURE_MODES: CaptureMode[] = [
  {
    id: "voice",
    label: "Voice",
    input: {
      title: "Recording",
      body: "Remember to ask Andrea about the API migration on Monday.",
      meta: "0:04",
    },
    understood: [
      { type: "person", label: "Andrea" },
      { type: "time", label: "Monday" },
      { type: "topic", label: "API migration" },
    ],
    summary: "Transcribed, and set to come back Monday morning.",
  },
  {
    id: "text",
    label: "Text",
    input: {
      title: "Thought",
      body: "Maybe onboarding should start with voice capture. Sketch it before Thursday's review with Giulia.",
    },
    understood: [
      { type: "topic", label: "Onboarding" },
      { type: "time", label: "Thursday" },
      { type: "person", label: "Giulia" },
    ],
    summary: "Filed with the other onboarding notes. No folder needed.",
  },
  {
    id: "photo",
    label: "Photo",
    input: {
      title: "Receipt",
      body: "Trattoria da Nennella · Tavolo 7 · € 64,00",
      meta: "IMG_4412",
    },
    understood: [
      { type: "topic", label: "Dinner" },
      { type: "place", label: "Milan" },
      { type: "time", label: "March 18" },
    ],
    summary: "Read the receipt. Searchable by place, date and amount.",
  },
  {
    id: "file",
    label: "File",
    input: {
      title: "Blood Tests — February 2026.pdf",
      body: "Vitamin D 18 ng/mL · Ferritin 42 ng/mL · Glucose 89 mg/dL",
      meta: "2 pages · 412 KB",
    },
    understood: [
      { type: "topic", label: "Health" },
      { type: "topic", label: "Vitamin D" },
      { type: "person", label: "Dr. Rossi" },
      { type: "note", label: "Annual checkup" },
    ],
    summary: "Understood the contents and linked it to your annual checkup.",
  },
  {
    id: "link",
    label: "Link",
    input: {
      title: "Osteria del Binari — Milano",
      body: "osteriadelbinari.it",
      meta: "Sarah sent this",
    },
    understood: [
      { type: "place", label: "Milan" },
      { type: "person", label: "Sarah" },
      { type: "topic", label: "Restaurants" },
    ],
    summary: "Kept the page, the place and who recommended it.",
  },
  {
    id: "location",
    label: "Location",
    input: {
      title: "IKEA Roma Anagnina",
      body: "Buy the KALLAX inserts when I'm here.",
    },
    understood: [
      { type: "place", label: "Near IKEA" },
      { type: "topic", label: "Home" },
    ],
    summary: "Will surface itself when you arrive. Nothing to schedule.",
  },
];

/* --------------------------------------------------------------------------
 * Stories
 * ------------------------------------------------------------------------ */

export type Story = {
  id: string;
  eyebrow: string;
  title: string;
  lines: string[];
  fragment: Fragment;
  /** What happens later. */
  later: { when: string; prompt: string; result: string };
};

export const STORIES: Story[] = [
  {
    id: "walking",
    eyebrow: "A thought, mid-walk",
    title: "You're walking somewhere and remember something.",
    lines: [
      "There's no form to fill in, no date picker, no project to choose.",
      "You just say it.",
    ],
    fragment: {
      id: "s-voice",
      kind: "voice",
      title: "Voice note",
      body: "Remind me tomorrow morning to email Luca about the deposit.",
      meta: "0:05",
      context: [
        { type: "time", label: "Tomorrow · 09:00" },
        { type: "person", label: "Luca" },
        { type: "topic", label: "Deposit" },
      ],
    },
    later: {
      when: "Tomorrow, 09:00",
      prompt: "Email Luca about the deposit",
      result: "The note comes back on its own, with the recording attached.",
    },
  },
  {
    id: "document",
    eyebrow: "A document, months later",
    title: "Someone sends you a contract. You drop it in and move on.",
    lines: [
      "You don't name it properly. You don't pick a folder.",
      "Three months later, you ask for it in plain words.",
    ],
    fragment: {
      id: "s-file",
      kind: "file",
      title: "Contratto_locazione_FINAL(2).pdf",
      meta: "From Luca · 6 pages",
      context: [
        { type: "topic", label: "Rental contract" },
        { type: "person", label: "Luca" },
        { type: "place", label: "Via Sannio 12" },
      ],
    },
    later: {
      when: "June",
      prompt: "Where's the rental contract Luca sent me?",
      result: "Found, by what it is — not by what the file was called.",
    },
  },
  {
    id: "photo",
    eyebrow: "Something you see",
    title: "You see something worth keeping. You take a picture.",
    lines: [
      "A wine label, a whiteboard, a receipt, a poster.",
      "The image itself becomes something you can search.",
    ],
    fragment: {
      id: "s-photo",
      kind: "photo",
      title: "Photo",
      meta: "Whiteboard · Office",
      body: "Q3 roadmap — voice capture first, then reminders, then sharing",
      context: [
        { type: "topic", label: "Q3 roadmap" },
        { type: "place", label: "Office" },
        { type: "organization", label: "ByteBiz" },
      ],
    },
    later: {
      when: "Two weeks later",
      prompt: "What did we put on the whiteboard about Q3?",
      result:
        "The photo, with the text read out of it and the notes it relates to.",
    },
  },
];

/* --------------------------------------------------------------------------
 * Search demo
 * ------------------------------------------------------------------------ */

export type SearchResult = {
  kind: FragmentKind;
  title: string;
  detail: string;
  context: ContextTag[];
};

export type SearchExample = {
  query: string;
  results: SearchResult[];
};

export const SEARCH_EXAMPLES: SearchExample[] = [
  {
    query: "What did I want to ask Andrea?",
    results: [
      {
        kind: "voice",
        title: "Ask Andrea about the API migration",
        detail: "Voice note · Tuesday, 18:12",
        context: [
          { type: "person", label: "Andrea" },
          { type: "time", label: "Monday" },
        ],
      },
      {
        kind: "text",
        title: "Migration risks to raise",
        detail: "Note · Related through Andrea and API migration",
        context: [{ type: "topic", label: "API migration" }],
      },
    ],
  },
  {
    query: "Show me the blood tests I uploaded earlier this year",
    results: [
      {
        kind: "file",
        title: "Blood Tests — February 2026.pdf",
        detail: "Document · 12 February",
        context: [
          { type: "topic", label: "Health" },
          { type: "person", label: "Dr. Rossi" },
        ],
      },
      {
        kind: "voice",
        title: "Ask about vitamin D",
        detail: "Voice note · Linked to Annual checkup",
        context: [{ type: "topic", label: "Vitamin D" }],
      },
      {
        kind: "reminder",
        title: "Pick up prescription",
        detail: "Reminder · Near Farmacia Centrale",
        context: [{ type: "place", label: "Farmacia Centrale" }],
      },
    ],
  },
  {
    query: "What was the restaurant Sarah recommended in Milan?",
    results: [
      {
        kind: "link",
        title: "Osteria del Binari",
        detail: "Link · Sarah sent it in April",
        context: [
          { type: "person", label: "Sarah" },
          { type: "place", label: "Milan" },
        ],
      },
      {
        kind: "photo",
        title: "Receipt — Trattoria da Nennella",
        detail: "Photo · Also in Milan, March 18",
        context: [{ type: "place", label: "Milan" }],
      },
    ],
  },
  {
    query: "Which notes do I have about onboarding?",
    results: [
      {
        kind: "text",
        title: "Onboarding should start with voice capture",
        detail: "Thought · Last week",
        context: [{ type: "topic", label: "Onboarding" }],
      },
      {
        kind: "photo",
        title: "Whiteboard — Q3 roadmap",
        detail: "Photo · Office",
        context: [
          { type: "topic", label: "Q3 roadmap" },
          { type: "place", label: "Office" },
        ],
      },
      {
        kind: "person",
        title: "Giulia",
        detail: "Appears in 4 onboarding notes",
        context: [{ type: "person", label: "Giulia" }],
      },
    ],
  },
];

/* --------------------------------------------------------------------------
 * Connected notes
 * ------------------------------------------------------------------------ */

export type GraphNode = {
  id: string;
  kind: FragmentKind | "note";
  label: string;
  detail: string;
  /** Position in a 0–100 coordinate space, used only on wide screens. */
  x: number;
  y: number;
};

export const GRAPH_CENTER: GraphNode = {
  id: "checkup",
  kind: "note",
  label: "Annual Health Check",
  detail: "Note · 5 connections",
  x: 50,
  y: 50,
};

export const GRAPH_NODES: GraphNode[] = [
  {
    id: "blood",
    kind: "file",
    label: "Blood Tests — Feb 2026",
    detail: "Document",
    x: 18,
    y: 22,
  },
  {
    id: "doctor",
    kind: "reminder",
    label: "Dr. Rossi, 14 March",
    detail: "Appointment",
    x: 80,
    y: 18,
  },
  {
    id: "vitd",
    kind: "voice",
    label: "“Ask about vitamin D”",
    detail: "Voice note",
    x: 86,
    y: 62,
  },
  {
    id: "rx",
    kind: "file",
    label: "Prescription.pdf",
    detail: "Document",
    x: 62,
    y: 88,
  },
  {
    id: "pharmacy",
    kind: "location",
    label: "Pick up at Farmacia Centrale",
    detail: "Location reminder",
    x: 16,
    y: 76,
  },
];

/** Edges between the outer nodes; every outer node also links to the centre. */
export const GRAPH_EDGES: Array<[string, string]> = [
  ["blood", "vitd"],
  ["vitd", "rx"],
  ["rx", "pharmacy"],
  ["doctor", "vitd"],
];

/* --------------------------------------------------------------------------
 * Automatic context
 * ------------------------------------------------------------------------ */

export type Highlight = { text: string; type?: ContextType };

/** The sentence is split so entity spans can be coloured inline. */
export const CONTEXT_SENTENCE: Highlight[] = [
  { text: "Dinner with " },
  { text: "Sarah", type: "person" },
  { text: " at " },
  { text: "Osteria del Binari", type: "place" },
  { text: " on " },
  { text: "Friday", type: "time" },
  { text: " — she wants to talk about the " },
  { text: "Japan trip", type: "topic" },
  { text: ". Bring the itinerary Marco sent." },
];

export const CONTEXT_DERIVED: Array<{
  type: ContextType;
  label: string;
  detail: string;
}> = [
  { type: "time", label: "Friday · 20:30", detail: "Will remind you at 19:30" },
  {
    type: "place",
    label: "Osteria del Binari",
    detail: "Milan · Sarah recommended it",
  },
  { type: "person", label: "Sarah", detail: "Appears in 12 notes" },
  { type: "topic", label: "Japan trip", detail: "Connected to 7 notes" },
  {
    type: "note",
    label: "Itinerary — Japan.pdf",
    detail: "From Marco · Linked automatically",
  },
];

/* --------------------------------------------------------------------------
 * No filing
 * ------------------------------------------------------------------------ */

export const FOLDER_TREE: Array<{ depth: number; label: string; file?: true }> =
  [
    { depth: 0, label: "Documents" },
    { depth: 1, label: "Health" },
    { depth: 2, label: "2025" },
    { depth: 2, label: "2026" },
    { depth: 3, label: "Feb" },
    { depth: 4, label: "blood_test.pdf", file: true },
    { depth: 4, label: "blood_test_FINAL.pdf", file: true },
    { depth: 4, label: "blood_test_FINAL (1).pdf", file: true },
    { depth: 1, label: "Personal" },
    { depth: 2, label: "Misc" },
    { depth: 3, label: "Screenshots to sort" },
    { depth: 1, label: "Untitled folder" },
  ];

export const FILING_OLD = [
  "Folders",
  "Tags",
  "Naming conventions",
  "Filing things away",
  "Forgetting where",
];

export const FILING_NEW = ["Capture", "Understand", "Connect", "Retrieve"];

/* --------------------------------------------------------------------------
 * Philosophy
 * ------------------------------------------------------------------------ */

export const PRINCIPLES: Array<{ title: string; body: string }> = [
  {
    title: "One note holds everything.",
    body: "A note isn't a photo or a voice memo. It's a container for words, recordings, pictures and files at once — and Lictory reads all of it together.",
  },
  {
    title: "Suggestions look like suggestions.",
    body: "Every connection Lictory makes is visibly a proposal until you confirm it. Correct it once and it stays corrected. Your decisions are never overwritten.",
  },
  {
    title: "Private by default.",
    body: "Your memory is yours. Files sit in private storage, and nothing you save is shared with anyone unless you choose to.",
  },
];

export const NAV_LINKS: Array<{ label: string; href: string }> = [
  { label: "Product", href: "#capture" },
  { label: "How it works", href: "#how-it-works" },
  { label: "Use cases", href: "#stories" },
  { label: "Philosophy", href: "#philosophy" },
];
