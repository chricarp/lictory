import defaultMdxComponents from "fumadocs-ui/mdx";
import { Pre } from "fumadocs-ui/components/codeblock";
import { Step, Steps } from "fumadocs-ui/components/steps";
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
    Step,
    Steps,
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
