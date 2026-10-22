import { useMemo, useRef } from "react";
import { useQuery } from "@rocicorp/zero/react";
import type { Directory } from "@lictory/core/contracts/protocol";
import type { OrganizationProfile } from "@lictory/core/contracts/projection";
import { queries } from "@lictory/zero/queries";

type Organization = Directory["organizations"][number];

// The organizations I belong to, from my synchronized membership rows. A row
// disappears from this subscription as soon as the membership is removed.
export function useMemberships() {
  const [rows, result] = useQuery(queries.memberships());
  const previous = useRef<Organization[]>([]);
  const organizations = useMemo(() => {
    const next = rows
      .flatMap((member): Organization[] => {
        const profile = member.organization.find(
          (r) => r.type === "organizationProfile",
        )?.data as OrganizationProfile | undefined;
        return profile
          ? [
              {
                id: member.organizationId,
                name: profile.name,
                slug: profile.slug,
                role: member.role,
                logos: profile.logos ?? { mark: null, full: null },
              },
            ]
          : [];
      })
      .sort((a, b) => a.name.localeCompare(b.name) || a.id.localeCompare(b.id));
    if (JSON.stringify(next) === JSON.stringify(previous.current))
      return previous.current;
    previous.current = next;
    return next;
  }, [rows]);
  return {
    organizations,
    complete: result.type === "complete",
    error: result.type === "error" ? result.error.message : undefined,
  };
}
