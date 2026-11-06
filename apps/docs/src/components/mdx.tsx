import defaultMdxComponents from "fumadocs-ui/mdx";
import { Step, Steps } from "fumadocs-ui/components/steps";
import type { MDXComponents } from "mdx/types";

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
