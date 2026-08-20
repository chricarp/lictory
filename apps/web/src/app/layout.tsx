import type { Metadata, Viewport } from "next";
import { Inter, JetBrains_Mono } from "next/font/google";
import { Toaster } from "sonner";

import "./globals.css";

const inter = Inter({
  subsets: ["latin"],
  variable: "--font-inter",
  display: "swap",
});

const mono = JetBrains_Mono({
  subsets: ["latin"],
  variable: "--font-mono-face",
  display: "swap",
});

export const metadata: Metadata = {
  metadataBase: new URL("https://lictory.com"),
  title: {
    default: "Lictory — Context that finds you again",
    template: "%s · Lictory",
  },
  description:
    "Keep notes, voice, photos and files together. Easy to save, easy to find, and private by default.",
  openGraph: {
    title: "Lictory — Context that finds you again",
    description:
      "Keep the whole moment. Notes, voice, photos and files in one private place.",
    type: "website",
    images: [
      {
        url: "/og-v2.png",
        width: 1731,
        height: 909,
        alt: "Lictory — Remember the context, not just the note.",
      },
    ],
  },
  twitter: {
    card: "summary_large_image",
    title: "Lictory — Context that finds you again",
    description:
      "Keep the whole moment. Notes, voice, photos and files in one private place.",
    images: ["/og-v2.png"],
  },
};

export const viewport: Viewport = {
  themeColor: [
    { media: "(prefers-color-scheme: light)", color: "#ffffff" },
    { media: "(prefers-color-scheme: dark)", color: "#000000" },
  ],
  colorScheme: "dark light",
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en" className={`${inter.variable} ${mono.variable}`}>
      <body className="antialiased">
        {children}
        <Toaster
          position="bottom-right"
          toastOptions={{
            classNames: {
              toast:
                "!bg-canvas-raised !border-hairline-strong !text-foreground !rounded-lg",
              description: "!text-muted",
            },
          }}
        />
      </body>
    </html>
  );
}
