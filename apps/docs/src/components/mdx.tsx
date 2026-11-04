import defaultMdxComponents from "fumadocs-ui/mdx";
import { Step, Steps } from "fumadocs-ui/components/steps";
import type { MDXComponents } from "mdx/types";

import { Cli, CliNotice, CliReference } from "@lictory/docs/components/cli";
import { Lifecycle } from "@lictory/docs/components/lifecycle";

export function getMDXComponents(components?: MDXComponents) {
  return {
    ...defaultMdxComponents,
    Step,
    Steps,
    Cli,
    CliNotice,
    CliReference,
    Lifecycle,
    ...components,
  } satisfies MDXComponents;
}

declare global {
  type MDXProvidedComponents = ReturnType<typeof getMDXComponents>;
}
