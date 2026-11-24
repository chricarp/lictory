import { Library, Plus } from "lucide-react";
import { paths } from "@lictory/core/lib/paths";
import { useWorkspace } from "@lictory/platform/components/workspace/provider";
import { useShell } from "@lictory/platform/components/workspace/shell";
import {
  useNavigationSpaces,
  useSpaces,
} from "@lictory/platform/components/spaces/store";
import { SpaceIcon } from "@lictory/platform/components/spaces/space-meta";
import {
  SidebarAction,
  SidebarGroup,
  SidebarLink,
  useNavActive,
} from "@lictory/platform/components/shell/sidebar-parts";
import type { NavSection } from "@lictory/platform/components/shell/nav-registry";

// Lictory Spaces: every space overview, then the organization's spaces and
// those of my projects and teams. The project in context lists its own
// spaces with its rows; they are not repeated here.
function SpacesSection() {
  const { organization } = useWorkspace();
  const { project } = useShell();
  const { openCreateSpace } = useSpaces();
  const active = useNavActive();
  const spaces = useNavigationSpaces().sidebar.filter(
    (space) => space.projectId !== project?.id,
  );
  const org = organization.slug;
  const all = paths.spaces(org);
  return (
    <SidebarGroup
      id="spaces"
      label="Spaces"
      actions={
        <SidebarAction label="New space" onClick={() => openCreateSpace()}>
          <Plus aria-hidden />
        </SidebarAction>
      }
    >
      <SidebarLink href={all} active={active(all, true)} icon={<Library />}>
        All spaces
      </SidebarLink>
      {spaces.map((space) => {
        const href = paths.space(org, space.slug);
        return (
          <SidebarLink
            key={space.id}
            href={href}
            active={active(href)}
            icon={<SpaceIcon space={space} />}
          >
            {space.name}
          </SidebarLink>
        );
      })}
    </SidebarGroup>
  );
}

export const spacesSection: NavSection = {
  id: "spaces",
  label: "Spaces",
  icon: Library,
  href: paths.spaces,
  Section: SpacesSection,
};
