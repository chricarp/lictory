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
          {items.map((item, index) => {
            const depth = Math.max(0, item.depth - 2);
            const previousDepth = Math.max(
              0,
              (items[index - 1]?.depth ?? item.depth) - 2,
            );
            const x = depth * 12 + 7;
            const previousX = previousDepth * 12 + 7;
            const width = Math.max(x, previousX) + 4;
            const first = index === 0;
            const last = index === items.length - 1;
            return (
              <TOCItem
                key={item.url}
                href={item.url}
                aria-current={
                  item.url === `#${active}` ? "location" : undefined
                }
                style={{ "--toc-depth": depth } as CSSProperties}
              >
                <svg
                  className="docs-toc-rail"
                  aria-hidden="true"
                  style={{ width: `${width / 16}rem` }}
                >
                  {!first && (
                    <svg
                      width="100%"
                      height="0.75em"
                      viewBox={`0 0 ${width} 12`}
                      preserveAspectRatio="none"
                    >
                      <path
                        d={`M ${previousX} 0 C ${previousX} 8 ${x} 4 ${x} 12`}
                        vectorEffect="non-scaling-stroke"
                      />
                    </svg>
                  )}
                  <line
                    x1={`${x / 16}em`}
                    x2={`${x / 16}em`}
                    y1={first ? "1.375em" : "0.75em"}
                    y2={last ? "1.375em" : "100%"}
                  />
                </svg>
                <span className="docs-toc-dot" aria-hidden="true" />
                <span>{item.title}</span>
              </TOCItem>
            );
          })}
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
