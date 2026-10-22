import type { Metadata } from "next";

import {
  guidesFeedPath,
  indexableRobots,
  marketingImage,
  publicPage,
  siteName,
} from "@lictory/marketing/lib/site";
import { hasMarkdown, markdownPath } from "@lictory/marketing/lib/markdown";

/**
 * Metadata for an indexable public page other than the landing page, built from
 * the same facts as the sitemap and llms.txt. Sharing it gives the page its own
 * title and canonical URL in link previews instead of the root defaults.
 */
export function publicPageMetadata(
  path: string,
  {
    type = "website",
    ownImage = false,
  }: {
    type?: "website" | "article";
    /** The route has its own opengraph-image and twitter-image files. */
    ownImage?: boolean;
  } = {},
): Metadata {
  const { title, description, lastModified } = publicPage(path);
  const alternateTypes = {
    ...(hasMarkdown(path) ? { "text/markdown": markdownPath(path) } : {}),
    ...(path === "/guides" || path.startsWith("/guides/")
      ? { "application/rss+xml": [{ url: guidesFeedPath, title: "Guides" }] }
      : {}),
  };
  // Titles that already name the product are not suffixed with it again.
  const socialTitle = title.includes(siteName)
    ? title
    : `${title} · ${siteName}`;
  // Next.js only applies a route's generated card when `images` is absent,
  // not merely undefined.
  const images = ownImage
    ? {}
    : {
        images: [
          {
            url: marketingImage.path,
            width: marketingImage.width,
            height: marketingImage.height,
            alt: marketingImage.alt,
          },
        ],
      };
  return {
    title: { absolute: socialTitle },
    description,
    robots: indexableRobots,
    alternates: {
      canonical: path,
      ...(Object.keys(alternateTypes).length ? { types: alternateTypes } : {}),
    },
    openGraph: {
      title: socialTitle,
      description,
      url: path,
      siteName,
      locale: "en_US",
      ...images,
      ...(type === "article"
        ? { type, ...(lastModified ? { modifiedTime: lastModified } : {}) }
        : { type }),
    },
    twitter: {
      card: "summary_large_image",
      title: socialTitle,
      description,
      ...images,
    },
  };
}
