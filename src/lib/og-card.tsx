import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { ImageResponse } from "next/og";

export const ogCardSize = { width: 1200, height: 630 };

/** The branded 1200×630 social card, rendered locally without remote assets. */
export async function ogCard({
  eyebrow,
  title,
  subtitle,
  footer,
  titleSize = 72,
  headers,
}: {
  eyebrow: string;
  title: string;
  subtitle: string;
  footer: [string, string];
  titleSize?: number;
  headers?: Record<string, string>;
}) {
  const logo = await readFile(
    join(process.cwd(), "public/brand/lictory-logo.svg"),
  );
  return new ImageResponse(
    <div
      style={{
        display: "flex",
        flexDirection: "column",
        width: "100%",
        height: "100%",
        background: "#101114",
        color: "#fafafa",
        padding: "60px 72px",
        fontFamily: "sans-serif",
        backgroundImage:
          "radial-gradient(ellipse at top right, #303345 0%, #101114 65%)",
      }}
    >
      <div
        style={{
          display: "flex",
          alignItems: "center",
        }}
      >
        {/* ImageResponse renders the SVG directly; Next Image is for browsers. */}
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img
          src={`data:image/svg+xml;base64,${logo.toString("base64")}`}
          alt="Lictory"
          width={194}
          height={48}
        />
      </div>
      <div
        style={{
          display: "flex",
          marginTop: 64,
          fontSize: 18,
          color: "#b8b9c6",
          letterSpacing: 3,
        }}
      >
        {eyebrow}
      </div>
      <div
        style={{
          display: "flex",
          fontSize: titleSize,
          fontWeight: 700,
          lineHeight: 1.08,
          letterSpacing: -3,
          maxWidth: 930,
          marginTop: 20,
        }}
      >
        {title}
      </div>
      <div
        style={{
          display: "flex",
          fontSize: 25,
          color: "#b8b9c6",
          marginTop: 26,
          maxWidth: 850,
          lineHeight: 1.4,
        }}
      >
        {subtitle}
      </div>
      <div
        style={{
          display: "flex",
          marginTop: "auto",
          paddingTop: 24,
          borderTop: "1px solid #34353e",
          justifyContent: "space-between",
          fontSize: 19,
          color: "#d5d5df",
        }}
      >
        <span>{footer[0]}</span>
        <span>{footer[1]}</span>
      </div>
    </div>,
    { ...ogCardSize, headers },
  );
}
