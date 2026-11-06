import type { Metadata } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import { DocsLayout } from "fumadocs-ui/layouts/docs";
import { RootProvider } from "fumadocs-ui/provider/next";

import { ConsentProvider } from "@lictory/ui/consent/consent-provider";

import "./styles.css";
import { NavCtaTracking } from "@lictory/docs/components/analytics";
import StaticSearchDialog from "@lictory/docs/components/search";
import { baseOptions, LegalLinks } from "@lictory/docs/lib/layout.shared";
import { site } from "@lictory/docs/lib/site";
import { source } from "@lictory/docs/lib/source";

const geistSans = Geist({ variable: "--font-geist-sans", subsets: ["latin"] });
const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  metadataBase: new URL(site.url),
  applicationName: site.name,
  title: { default: site.name, template: `%s · ${site.name}` },
  description: site.description,
};

// Analytics as on the website (packages/ui/src/consent/consent-provider.tsx):
// PostHog through the first-party /relay, only when the build carries PostHog
// settings; without them nothing loads and no banner shows.
export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html
      lang="en"
      suppressHydrationWarning
      className={`${geistSans.variable} ${geistMono.variable} antialiased`}
    >
      <body className="flex min-h-screen flex-col">
        <ConsentProvider site="docs" privacyHref={`${site.website}/privacy`}>
          <RootProvider search={{ SearchDialog: StaticSearchDialog }}>
            <DocsLayout
              tree={source.getPageTree()}
              {...baseOptions()}
              sidebar={{ footer: <LegalLinks /> }}
            >
              {children}
            </DocsLayout>
          </RootProvider>
          <NavCtaTracking />
        </ConsentProvider>
      </body>
    </html>
  );
}
