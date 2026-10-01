import type { Metadata } from "next";
import { Geist, Geist_Mono } from "next/font/google";

import "~/app/globals.css";
import { ConsentProvider } from "~/components/app/consent-provider";
import { appearanceBootScript } from "~/lib/appearance";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  metadataBase: new URL(process.env.BETTER_AUTH_URL ?? "http://localhost:3000"),
  title: {
    default: "Lictory",
    template: "%s · Lictory",
  },
  description: "Collaborative engineering readiness.",
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
