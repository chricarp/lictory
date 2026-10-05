import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { ImageResponse } from "next/og";
import { previewLabels } from "~/lib/social-preview";

export const dynamic = "force-static";
export function generateStaticParams() {
  return ["marketing", ...Object.keys(previewLabels)].map((kind) => ({ kind }));
}
export const dynamicParams = false;

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ kind: string }> },
) {
  const { kind } = await params;
  if (kind !== "marketing" && !Object.hasOwn(previewLabels, kind))
    return new Response(null, { status: 404 });
  const marketing = kind === "marketing";
  const label = marketing
    ? "Requirements, reviewed like code."
    : `${previewLabels[kind as keyof typeof previewLabels]} in Lictory`;
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
        {marketing
          ? "LESS AMBIGUITY. MORE MOMENTUM."
          : "SHARED WORK · PRIVATE DETAILS"}
      </div>
      <div
        style={{
          display: "flex",
          fontSize: marketing ? 76 : 72,
          fontWeight: 700,
          lineHeight: 1.08,
          letterSpacing: -3,
          maxWidth: 930,
          marginTop: 20,
        }}
      >
        {label}
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
        {marketing
          ? "Turn product intent into work your team can commit to."
          : "Sign in with an account that has access to see the details."}
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
        <span>
          {marketing
            ? "Draft → Review → Refine → Deliver"
            : "Requirements, reviewed like code."}
        </span>
        <span>
          {marketing ? "Built for agreement." : "Access stays with your team."}
        </span>
      </div>
    </div>,
    {
      width: 1200,
      height: 630,
      headers: {
        "Cache-Control": "public, max-age=86400",
        "X-Content-Type-Options": "nosniff",
      },
    },
  );
}
