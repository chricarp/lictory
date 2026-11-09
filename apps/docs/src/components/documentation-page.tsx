"use client";

import type { CSSProperties } from "react";
import { TOCItem, useActiveAnchor } from "fumadocs-core/toc";
import { TOCScrollArea, useTOCItems } from "fumadocs-ui/components/toc";
import { DocsPage, type DocsPageProps } from "fumadocs-ui/layouts/docs/page";
import {
  TOCProvider,
  TOCPopover,
} from "fumadocs-ui/layouts/docs/page/slots/toc";

function PageContents() {
  const items = useTOCItems();
  const active = useActiveAnchor();
  if (!items.length) return <div id="nd-toc-placeholder" />;

  return (
    <nav id="nd-toc" className="docs-toc" aria-labelledby="toc-title">
      <h2 id="toc-title">On this page</h2>
      <TOCScrollArea>
        <div className="docs-toc-list">
          {items.map((item) => (
            <TOCItem
              key={item.url}
              href={item.url}
              aria-current={item.url === `#${active}` ? "location" : undefined}
              style={
                { "--toc-depth": Math.max(0, item.depth - 2) } as CSSProperties
              }
            >
              <span className="docs-toc-dot" aria-hidden="true" />
              <span>{item.title}</span>
            </TOCItem>
          ))}
        </div>
      </TOCScrollArea>
    </nav>
  );
}

const tocSlots = {
  provider: TOCProvider,
  main: PageContents,
  popover: TOCPopover,
};

export function DocumentationPage(props: DocsPageProps) {
  return (
    <DocsPage
      {...props}
      tableOfContent={{ single: true }}
      tableOfContentPopover={{ style: "block" }}
      slots={{ toc: tocSlots }}
    />
  );
}
