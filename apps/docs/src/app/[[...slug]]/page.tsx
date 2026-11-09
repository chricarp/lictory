import type { Metadata } from "next";
import { notFound } from "next/navigation";
import {
  DocsBody,
  DocsDescription,
  DocsTitle,
} from "fumadocs-ui/layouts/docs/page";
import { createRelativeLink } from "fumadocs-ui/mdx";

import { DocumentationPage } from "@lictory/docs/components/documentation-page";
import { getMDXComponents } from "@lictory/docs/components/mdx";
import { source } from "@lictory/docs/lib/source";

export default async function Page(props: PageProps<"/[[...slug]]">) {
  const { slug } = await props.params;
  const page = source.getPage(slug);
  if (!page) notFound();
  const Content = page.data.body;
  return (
    <DocumentationPage toc={page.data.toc} full={page.data.full}>
      <DocsTitle className="docs-title">{page.data.title}</DocsTitle>
      <DocsDescription className="docs-lede mb-8">
        {page.data.description}
      </DocsDescription>
      <DocsBody className="docs-body">
        <Content
          components={getMDXComponents({ a: createRelativeLink(source, page) })}
        />
      </DocsBody>
    </DocumentationPage>
  );
}

export function generateStaticParams() {
  return source.generateParams();
}

export async function generateMetadata(
  props: PageProps<"/[[...slug]]">,
): Promise<Metadata> {
  const { slug } = await props.params;
  const page = source.getPage(slug);
  if (!page) notFound();
  return {
    title: slug?.length ? page.data.title : { absolute: "Lictory Docs" },
    description: page.data.description,
    alternates: { canonical: page.url },
  };
}
