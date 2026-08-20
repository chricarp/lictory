import type { Metadata } from "next";

import { NotesFeed } from "@/components/notes/notes-feed";

export const metadata: Metadata = { title: "Notes" };

export default function NotesPage() {
  return <NotesFeed />;
}
