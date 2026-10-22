import { redirect } from "next/navigation";

// Preserve old bookmarks while keeping personal settings outside organization
// routing and organization-specific workspace state.
export default function LegacyWorkspaceAccountPage() {
  redirect("/app/account");
}
