import { RoundupPage } from "@lictory/marketing/components/marketing/roundup-page";
import { roundup } from "@lictory/marketing/content/roundups";
import { publicPageMetadata } from "@lictory/marketing/lib/public-metadata";

const path = "/best-requirements-management-tools";

export const metadata = publicPageMetadata(path, { ownImage: true });

export default function Page() {
  return <RoundupPage roundup={roundup(path)!} />;
}
