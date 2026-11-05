import type { Metadata } from "next";
import Link from "next/link";
import {
  DocsBody,
  DocsDescription,
  DocsPage,
  DocsTitle,
} from "fumadocs-ui/layouts/docs/page";

export const metadata: Metadata = { title: "Page not found" };

// Inside DocsPage like every other page: the docs layout is a grid, and
// only DocsPage takes the content column (a bare <main> landed in the
// sidebar's column, squeezed to a sliver on phones).
export default function NotFound() {
  return (
    <DocsPage toc={[]}>
      <DocsTitle className="docs-title">This page does not exist</DocsTitle>
      <DocsDescription className="docs-lede mb-8">
        It may have moved. Search the documentation (Ctrl K), or start from one
        of these pages.
      </DocsDescription>
      <DocsBody className="docs-body">
        <ul>
          <li>
            <Link href="/">Introduction</Link>
          </li>
          <li>
            <Link href="/getting-started">Getting started</Link>
          </li>
          <li>
            <Link href="/self-hosting/install">Install a server</Link>
          </li>
        </ul>
      </DocsBody>
    </DocsPage>
  );
}
