import { Outlet } from "@tanstack/react-router";
import {
  AdminConsoleLayout,
  AdminSection,
} from "@lictory/platform/components/admin/admin-console";
import { useParams } from "@lictory/platform/lib/navigation";
import { PageTitle } from "@lictory/platform/routes/title";

export function AdminRoute() {
  return (
    <AdminConsoleLayout>
      <PageTitle title="Admin console" />
      <Outlet />
    </AdminConsoleLayout>
  );
}

export function AdminPage() {
  const { section } = useParams<{ section: string }>();
  return <AdminSection section={section} />;
}
