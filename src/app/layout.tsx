import type { Metadata, Viewport } from "next";
import { Geist, Geist_Mono } from "next/font/google";

import "~/app/globals.css";
import { ConsentProvider } from "~/components/app/consent-provider";
import { appearanceBootScript } from "~/lib/appearance";
import {
  indexableRobots,
  siteDescription,
  siteName,
  siteThemeColor,
  siteUrl,
} from "~/lib/site";

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

// Browser chrome follows the system appearance, like the app's default theme.
export const viewport: Viewport = {
  themeColor: [
    { media: "(prefers-color-scheme: light)", color: "#fcfcfd" },
    { media: "(prefers-color-scheme: dark)", color: siteThemeColor },
  ],
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
      <body className="min-h-full">
        <ConsentProvider>{children}</ConsentProvider>
      </body>
    </html>
  );
}
