import { createContext, useContext, type ReactNode } from "react";

// Section headings take their level from where they sit, so the outline of a
// page never skips a level: a page's title is its h1, the sections directly
// under it are h2, and a section's own sub-sections one level below that.
// A component that renders a heading of its own wraps what it contains in a
// `HeadingScope`; headings inside then sit one level deeper.
const LevelContext = createContext(2);

type Level = 2 | 3 | 4 | 5 | 6;

export function useHeadingLevel(): Level {
  return Math.min(useContext(LevelContext), 6) as Level;
}

// The headings inside sit one level below the current one (or at `level`).
export function HeadingScope({
  level,
  children,
}: {
  level?: Level;
  children: ReactNode;
}) {
  const current = useContext(LevelContext);
  return <LevelContext value={level ?? current + 1}>{children}</LevelContext>;
}

// A heading at the current level.
export function Heading({
  id,
  className,
  children,
}: {
  id?: string;
  className?: string;
  children: ReactNode;
}) {
  const Tag = `h${useHeadingLevel()}` as const;
  return (
    <Tag id={id} className={className}>
      {children}
    </Tag>
  );
}
