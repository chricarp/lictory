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
import {
  indexableRobots,
  markdownPath,
  site,
  socialImage,
} from "@lictory/docs/lib/site";
import { documentTitle } from "@lictory/docs/lib/sections";
import { source } from "@lictory/docs/lib/source";
import {
  pageStructuredData,
  serializeJsonLd,
} from "@lictory/docs/lib/structured-data";

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
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{
          __html: serializeJsonLd(pageStructuredData(page)),
        }}
      />
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
  const title = documentTitle(page);
  const images = [socialImage];
  return {
    title: { absolute: title },
    description: page.data.description,
    robots: indexableRobots,
    alternates: {
      canonical: page.url,
      types: { "text/markdown": markdownPath(page.url) },
    },
    openGraph: {
      type: slug?.length ? "article" : "website",
      title,
      description: page.data.description,
      url: page.url,
      siteName: site.name,
      locale: "en_US",
      images,
    },
    twitter: {
      card: "summary_large_image",
      title,
      description: page.data.description,
      images,
    },
  };
}
