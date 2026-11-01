import type { Metadata, Viewport } from "next";
import { Geist, Geist_Mono } from "next/font/google";

import "./styles.css";
import { ConsentProvider } from "@lictory/ui/consent/consent-provider";
import { appearanceBootScript } from "@lictory/core/lib/appearance";
import {
  indexableRobots,
  siteDescription,
  siteName,
  siteThemeColor,
  siteUrl,
} from "@lictory/marketing/lib/site";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  metadataBase: new URL(siteUrl),
  applicationName: siteName,
  title: {
    default: siteName,
    template: `%s · ${siteName}`,
  },
  description: siteDescription,
  creator: siteName,
  publisher: siteName,
  category: "technology",
  formatDetection: { email: false, address: false, telephone: false },
  // Lets search engines and AI answers show full snippets and large previews.
  robots: indexableRobots,
};

// The public website uses a consistent ink palette.
export const viewport: Viewport = {
  themeColor: siteThemeColor,
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html
      suppressHydrationWarning
      lang="en"
      className={`${geistSans.variable} ${geistMono.variable} h-full antialiased`}
    >
      <head>
        {/* Applies the saved light/dark preference before first paint. */}
        <script dangerouslySetInnerHTML={{ __html: appearanceBootScript }} />
      </head>
      <body className="marketing-site min-h-full">
        <ConsentProvider privacyHref="/privacy">{children}</ConsentProvider>
      </body>
    </html>
  );
}
