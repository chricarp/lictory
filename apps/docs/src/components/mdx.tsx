import defaultMdxComponents from "fumadocs-ui/mdx";
import { Pre } from "fumadocs-ui/components/codeblock";
import {
  ImageZoom,
  type ImageZoomProps,
} from "fumadocs-ui/components/image-zoom";
import { Step, Steps } from "fumadocs-ui/components/steps";
import { Tab, Tabs } from "fumadocs-ui/components/tabs";
import type { MDXComponents } from "mdx/types";
import type { ComponentProps } from "react";

import { TrackedCodeBlock } from "@lictory/docs/components/analytics";
import { Cli, CliNotice, CliReference } from "@lictory/docs/components/cli";
import { Lifecycle } from "@lictory/docs/components/lifecycle";
import {
  DirectPublishing,
  ReviewedChange,
  SpaceAccess,
} from "@lictory/docs/components/spaces";

// A section heading links to itself, and that is all it holds: Fumadocs'
// copy button sat inside the heading, so a screen reader's headings list
// read "Keyboard Copy Anchor Link" for every section. The heading's own link
// is the anchor to copy.
function heading(As: "h2" | "h3" | "h4" | "h5" | "h6") {
  return function Heading({
    id,
    children,
    className,
    ...props
  }: ComponentProps<"h2">) {
    if (!id)
      return (
        <As className={className} {...props}>
          {children}
        </As>
      );
    return (
      <As
        id={id}
        className={["scroll-m-28", className].filter(Boolean).join(" ")}
        {...props}
      >
        <a data-card="" href={`#${id}`}>
          {children}
        </a>
      </As>
    );
  };
}

export function getMDXComponents(components?: MDXComponents) {
  return {
    ...defaultMdxComponents,
    // Fumadocs' own code block, with the copy event.
    pre: (props) => (
      <TrackedCodeBlock {...props} surface="mdx">
        <Pre>{props.children}</Pre>
      </TrackedCodeBlock>
    ),
    // Screenshots open full size on click: detail crops keep their 2x
    // pixels, so the enlarged view stays sharp.
    img: (props) => <ImageZoom {...(props as ImageZoomProps)} />,
    h2: heading("h2"),
    h3: heading("h3"),
    h4: heading("h4"),
    h5: heading("h5"),
    h6: heading("h6"),
    Step,
    Steps,
    Tab,
    Tabs,
    Cli,
    CliNotice,
    CliReference,
    Lifecycle,
    DirectPublishing,
    ReviewedChange,
    SpaceAccess,
    ...components,
  } satisfies MDXComponents;
}

declare global {
  type MDXProvidedComponents = ReturnType<typeof getMDXComponents>;
}
