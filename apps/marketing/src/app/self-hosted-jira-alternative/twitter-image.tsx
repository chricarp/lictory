import { roundupCard } from "@lictory/marketing/lib/marketing-cards";
import { ogCardSize } from "@lictory/marketing/lib/og-card";

export const dynamic = "force-static";
export const size = ogCardSize;
export const contentType = "image/png";
export const alt = "Lictory comparison";

export default function Image() {
  return roundupCard("/self-hosted-jira-alternative");
}
