import type { Metadata } from "next";

import { ProfilePage } from "@/components/profile/profile-page";

export const metadata: Metadata = { title: "Profile & preferences" };

export default function ProfileSettingsPage() {
  return <ProfilePage />;
}
