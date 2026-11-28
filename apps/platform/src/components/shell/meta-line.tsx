import {
  Children,
  Fragment,
  isValidElement,
  type ReactElement,
  type ReactNode,
} from "react";
import { cn } from "@lictory/core/lib/utils";

// One line of facts under a title ("2m ago · Forge failed · The migration
// failed: …"), separated by middle dots. When the line wraps (phones, long
// parts), a separator never starts or ends a line: each dot belongs to the
// part after it, so they wrap together, and the line is shifted left by one
// dot's width inside a clipping box, so the dot of whichever part starts a
// line falls outside it. Parts are the line's children; fragments are
// flattened, and nothing (null, false, "") leaves no part and no dot.
// Write the facts without separators of your own.
export function MetaLine({
  children,
  className,
}: {
  children: ReactNode;
  className?: string;
}) {
  const parts = flatten(children);
  if (parts.length === 0) return null;
  return (
    <span
      data-meta-line
      className={cn(
        "block min-w-0 overflow-hidden text-xs leading-4 text-muted-foreground",
        className,
      )}
    >
      <span className="-ml-4 flex flex-wrap items-center gap-y-0.5">
        {parts.map((part, i) => (
          <Fragment key={i}>
            {isPart(part) ? part : <MetaPart>{part}</MetaPart>}
          </Fragment>
        ))}
      </span>
    </span>
  );
}

// One part of a `MetaLine`, with its dot. Pass it yourself to give the part
// classes of its own, such as `max-sm:hidden` (a hidden part takes its dot
// with it) or `shrink-0`.
export function MetaPart({
  children,
  className,
}: {
  children: ReactNode;
  className?: string;
}) {
  return (
    <span
      data-meta-part
      className={cn(
        "flex max-w-full min-w-0 items-center",
        // The dot is decoration: its alternative text is empty.
        "before:w-4 before:shrink-0 before:text-center before:content-['·'_/_'']",
        className,
      )}
    >
      {children}
    </span>
  );
}

function isPart(node: ReactNode): node is ReactElement {
  return isValidElement(node) && node.type === MetaPart;
}

function flatten(children: ReactNode): ReactNode[] {
  return Children.toArray(children).flatMap((child) =>
    isValidElement<{ children?: ReactNode }>(child) && child.type === Fragment
      ? flatten(child.props.children)
      : child === ""
        ? []
        : [child],
  );
}
