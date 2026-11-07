import defaultMdxComponents from "fumadocs-ui/mdx";
import { Pre } from "fumadocs-ui/components/codeblock";
import {
  ImageZoom,
  type ImageZoomProps,
} from "fumadocs-ui/components/image-zoom";
import { Step, Steps } from "fumadocs-ui/components/steps";
import { Tab, Tabs } from "fumadocs-ui/components/tabs";
import type { MDXComponents } from "mdx/types";

import { TrackedCodeBlock } from "@lictory/docs/components/analytics";
import { Cli, CliNotice, CliReference } from "@lictory/docs/components/cli";
import { Lifecycle } from "@lictory/docs/components/lifecycle";
import {
  DirectPublishing,
  ReviewedChange,
  SpaceAccess,
} from "@lictory/docs/components/spaces";

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
