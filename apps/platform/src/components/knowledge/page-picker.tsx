import { useMemo, useState } from "react";
import { FileText } from "lucide-react";
import { Picker } from "@lictory/ui/popover";
import { useSpaces } from "@lictory/platform/components/spaces/store";
import type { Space, SpacePage } from "@lictory/platform/data/spaces";

const SHOWN = 60;

export type PageChoice = { page: SpacePage; space: Space };

// Pages I can read (active pages of active spaces), searched by title and
// space. `first` puts some pages on top with a reason ("Attached");
// `editable` keeps only spaces where I can edit (branches need it).
export function PagePicker({
  title,
  onSelect,
  first,
  exclude,
  editable = false,
  keepOpen = false,
}: {
  title: string;
  onSelect: (choice: PageChoice) => void;
  first?: ReadonlyMap<string, string>;
  exclude?: ReadonlySet<string>;
  editable?: boolean;
  // Leaves the popover open (a second step follows).
  keepOpen?: boolean;
}) {
  const { index, levelOf } = useSpaces();
  const [query, setQuery] = useState("");
  const all = useMemo(() => {
    const out: PageChoice[] = [];
    for (const space of index.spaces) {
      if (space.archivedAt) continue;
      if (editable && levelOf(space.id) !== "edit") continue;
      for (const page of index.pagesBySpace.get(space.id) ?? [])
        if (!page.archivedAt && !exclude?.has(page.id))
          out.push({ page, space });
    }
    // Recently published first: what people are likely looking for.
    return out.sort((a, b) => b.page.updatedAt.localeCompare(a.page.updatedAt));
  }, [index, levelOf, editable, exclude]);
  const shown = useMemo(() => {
    const q = query.trim().toLowerCase();
    const matches = q
      ? all.filter(
          (c) =>
            c.page.title.toLowerCase().includes(q) ||
            c.space.name.toLowerCase().includes(q),
        )
      : all;
    const top = matches.filter((c) => first?.has(c.page.id));
    const rest = matches.filter((c) => !first?.has(c.page.id));
    return [...top, ...rest].slice(0, SHOWN);
  }, [all, query, first]);
  const byId = useMemo(() => new Map(all.map((c) => [c.page.id, c])), [all]);
  return (
    <Picker
      title={title}
      placeholder="Search pages by title or space"
      emptyText={
        all.length
          ? "No page matches."
          : editable
            ? "No pages in spaces you can edit."
            : "No pages you can read yet."
      }
      multiple={keepOpen}
      onQueryChange={setQuery}
      options={shown.map(({ page, space }) => ({
        value: page.id,
        label: page.title || "Untitled",
        hint: first?.get(page.id) ?? space.name,
        icon: <FileText className="size-3.5" aria-hidden />,
      }))}
      onSelect={(pageId) => {
        const choice = byId.get(pageId);
        if (choice) onSelect(choice);
      }}
    />
  );
}
