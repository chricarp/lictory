import { House } from "lucide-react";
import { paths } from "@lictory/core/lib/paths";
import { usePathname } from "@lictory/platform/lib/navigation";
import { useWorkspace } from "@lictory/platform/components/workspace/provider";
import { SidebarLink } from "@lictory/platform/components/shell/sidebar-parts";
import type { NavSection } from "@lictory/platform/components/shell/nav-registry";

function HomeSection() {
  const { organization } = useWorkspace();
  const pathname = usePathname();
  const href = paths.org(organization.slug);
  return (
    <SidebarLink
      href={href}
      active={pathname === href || pathname === `${href}/`}
      icon={<House />}
    >
      Home
    </SidebarLink>
  );
}

export const homeSection: NavSection = {
  id: "home",
  label: "Home",
  icon: House,
  href: paths.org,
  Section: HomeSection,
};
