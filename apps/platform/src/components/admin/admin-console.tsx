import { useEffect, useState, type FormEvent, type ReactNode } from "react";
import {
  Activity,
  ArrowLeft,
  Building2,
  CircleAlert,
  KeyRound,
  Mail,
  ShieldUser,
  UserPlus,
  Users,
} from "lucide-react";
import { paths } from "@lictory/core/lib/paths";
import { formValue } from "@lictory/core/lib/utils";
import {
  normalizeOrganizationHandle,
  suggestOrganizationHandle,
} from "@lictory/core/lib/organization-handles";
import { Button } from "@lictory/ui/button";
import {
  DropdownSelect,
  DropdownSelectOption,
} from "@lictory/ui/dropdown-select";
import { Input } from "@lictory/ui/input";
import { Avatar, Badge } from "@lictory/ui/primitives";
import { SettingsSectionSkeleton } from "@lictory/ui/skeleton";
import { MissingState } from "@lictory/ui/status-page";
import { Link } from "@lictory/platform/lib/navigation";
import { useSessionUser } from "@lictory/platform/lib/session";
import {
  InlineError,
  SettingsBody,
  SettingsLayout,
  SettingsList,
  SettingsSection,
  type SettingsNavItem,
} from "@lictory/platform/components/workspace/settings-section";
import {
  adminRequest,
  date,
  dateTime,
  signUpModeWords,
  useAdminResource,
  type ActivityPage,
  type AdminOrganization,
  type AdminUser,
  type Overview,
  type UserPage,
} from "@lictory/platform/components/admin/admin-api";

// The admin console: one installation's accounts, instance administrators,
// organizations and access policy, for instance administrators. Instance
// administrators manage the installation; they see no organization's work
// unless they are a member of it. See docs/internals/instance-administration.md.

const sections = [
  { id: "overview", label: "Overview" },
  { id: "people", label: "People" },
  { id: "organizations", label: "Organizations" },
  { id: "activity", label: "Activity" },
] as const;
type Section = (typeof sections)[number]["id"];

const fieldClass = "mt-1.5 h-9 rounded-lg text-sm";
const roles = [
  { value: "member", label: "Member" },
  { value: "admin", label: "Administrator" },
  { value: "owner", label: "Owner" },
] as const;
type Role = (typeof roles)[number]["value"];

const message = (e: unknown) =>
  e instanceof Error ? e.message : "Something went wrong. Try again.";

export function AdminConsoleLayout({ children }: { children: ReactNode }) {
  const user = useSessionUser();
  if (!user.instanceAdmin)
    return (
      <MissingState
        illustration="recovery"
        icon={ShieldUser}
        title="The admin console is for instance administrators"
        action={
          <Link href="/">
            <Button>Back to Lictory</Button>
          </Link>
        }
      >
        Ask your Lictory administrator if you need to manage accounts or
        organizations on this installation.
      </MissingState>
    );
  const nav: SettingsNavItem[] = sections.map((s) => ({
    ...s,
    group: "Installation",
    href: paths.admin(s.id === "overview" ? undefined : s.id),
  }));
  return (
    <div className="h-dvh">
      <SettingsLayout
        icon={
          <span
            aria-hidden
            className="grid size-10 shrink-0 place-items-center rounded-xl bg-primary/10 text-primary"
          >
            <ShieldUser className="size-5" />
          </span>
        }
        title="Admin console"
        subtitle={`${window.location.host} · accounts, organizations and access for this installation`}
        nav={nav}
      >
        <Link
          href="/"
          className="-mt-2 -ml-2 inline-flex h-8 items-center gap-1.5 rounded-md px-2 text-[13px] font-medium text-muted-foreground hover:bg-muted hover:text-foreground"
        >
          <ArrowLeft aria-hidden className="size-4" strokeWidth={1.75} />
          Back to Lictory
        </Link>
        {children}
      </SettingsLayout>
    </div>
  );
}

export function AdminSection({ section }: { section?: string }) {
  const active: Section =
    sections.find((s) => s.id === section)?.id ?? "overview";
  return (
    <>
      {active === "overview" && <AdminOverview />}
      {active === "people" && <People />}
      {active === "organizations" && <Organizations />}
      {active === "activity" && <ActivityLog />}
    </>
  );
}

function LoadFailure({ error, retry }: { error: string; retry: () => void }) {
  return (
    <MissingState
      illustration="recovery"
      icon={CircleAlert}
      tone="danger"
      title="This page could not be loaded"
      action={<Button onClick={retry}>Try again</Button>}
    >
      {error}
    </MissingState>
  );
}

// ------------------------------------------------------------------ overview

function Stat({
  label,
  value,
  hint,
}: {
  label: string;
  value: number;
  hint?: string;
}) {
  return (
    <div className="rounded-xl bg-card px-4 py-3 shadow-(--shadow-border)">
      <p className="text-xs text-muted-foreground">{label}</p>
      <p className="mt-1 text-2xl font-semibold tracking-tight tabular-nums">
        {value}
      </p>
      {hint && <p className="mt-0.5 text-xs text-muted-foreground">{hint}</p>}
    </div>
  );
}

function PolicyRow({
  label,
  value,
  detail,
}: {
  label: string;
  value: ReactNode;
  detail?: string;
}) {
  return (
    <div className="grid gap-1 px-5 py-3 text-[13px] sm:grid-cols-[200px_minmax(0,1fr)] sm:gap-4">
      <p className="text-muted-foreground">{label}</p>
      <div>
        <p className="font-medium">{value}</p>
        {detail && (
          <p className="mt-0.5 leading-5 text-muted-foreground">{detail}</p>
        )}
      </div>
    </div>
  );
}

function AdminOverview() {
  const { data, error, reload } = useAdminResource<Overview>("/overview");
  if (error && !data) return <LoadFailure error={error} retry={reload} />;
  if (!data) return <SettingsSectionSkeleton />;
  const mode = signUpModeWords[data.policy.signUpMode];
  const notices: ReactNode[] = [];
  if (data.policy.signUpMode === "open")
    notices.push(
      "Anyone who can reach this installation can create an account. Switch to invitations unless it is on a private network: sudo lictory install --signup-mode invite",
    );
  if (!data.email)
    notices.push(
      "This installation sends no email: invitations, verification and password reset links are not delivered. Create accounts with a password here, or configure outbound email: sudo lictory install --email smtp",
    );
  if (data.counts.administrators < 2)
    notices.push(
      "Only one person administers this installation. Make a second administrator so access never depends on one account.",
    );
  return (
    <>
      <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
        <Stat
          label="Accounts"
          value={data.counts.users - data.counts.deactivated}
          hint={
            data.counts.deactivated
              ? `${data.counts.deactivated} deactivated`
              : undefined
          }
        />
        <Stat
          label="Instance administrators"
          value={data.counts.administrators}
        />
        <Stat label="Organizations" value={data.counts.organizations} />
        <Stat
          label="Pending invitations"
          value={data.counts.pendingInvitations}
        />
      </div>
      {notices.length > 0 && (
        <div className="space-y-2" role="status">
          {notices.map((notice, i) => (
            <p
              key={i}
              className="flex gap-2 rounded-lg border border-amber-500/30 bg-amber-500/8 px-4 py-3 text-[13px] leading-5"
            >
              <CircleAlert
                aria-hidden
                className="mt-0.5 size-4 shrink-0 text-amber-600"
              />
              {notice}
            </p>
          ))}
        </div>
      )}
      <SettingsSection
        id="policy"
        icon={<KeyRound />}
        title="Access policy"
        description="Who can get an account and who can create organizations. The server enforces it for every sign-in method."
        footer={
          <>
            Set by the server operator in the installation’s configuration
            (LICTORY_SIGNUP_MODE, LICTORY_ALLOWED_EMAIL_DOMAINS,
            LICTORY_ORGANIZATION_CREATION). Change it on the server with{" "}
            <code className="font-mono">sudo lictory install</code>.
          </>
        }
      >
        <div className="divide-y divide-border">
          <PolicyRow
            label="New accounts"
            value={mode.title}
            detail={mode.detail}
          />
          <PolicyRow
            label="Email domains"
            value={
              data.policy.allowedEmailDomains.length
                ? data.policy.allowedEmailDomains.join(", ")
                : "Any domain"
            }
            detail={
              data.policy.allowedEmailDomains.length
                ? "Self-service and single sign-on accounts must use one of these. You can create accounts for any address."
                : undefined
            }
          />
          <PolicyRow
            label="New organizations"
            value={
              data.policy.organizationCreation === "administrators"
                ? "Instance administrators create them"
                : "Anyone with an account"
            }
          />
          <PolicyRow
            label="Organization deletion"
            value={`${data.policy.organizationDeletionGraceDays} days after an owner schedules it`}
            detail="The organization is locked meanwhile, and its owners can cancel."
          />
          <PolicyRow
            label="Sign-in"
            value={[
              data.signIn.password ? "Email and password" : null,
              data.signIn.sso ? `Single sign-on (${data.signIn.sso})` : null,
            ]
              .filter(Boolean)
              .join(" · ")}
            detail={
              data.signIn.sso
                ? "Your identity provider decides who may sign in with single sign-on; its people get an account on first sign-in when OIDC_AUTO_CREATE_USERS allows it."
                : undefined
            }
          />
          <PolicyRow
            label="Outbound email"
            value={data.email ? "Configured" : "Not configured"}
          />
        </div>
      </SettingsSection>
    </>
  );
}

// -------------------------------------------------------------------- people

const statuses = [
  { value: "all", label: "Everyone" },
  { value: "active", label: "Active" },
  { value: "administrators", label: "Administrators" },
  { value: "deactivated", label: "Deactivated" },
] as const;

function useDebounced(value: string, ms = 250) {
  const [debounced, setDebounced] = useState(value);
  useEffect(() => {
    const timer = setTimeout(() => setDebounced(value), ms);
    return () => clearTimeout(timer);
  }, [value, ms]);
  return debounced;
}

function People() {
  const me = useSessionUser();
  const [query, setQuery] = useState("");
  const [status, setStatus] = useState<string>("all");
  const [creating, setCreating] = useState(false);
  const [notice, setNotice] = useState<string>();
  // Later pages belong to the first page they continue; a new search or a
  // reload starts over.
  const [later, setLater] = useState<{
    after: UserPage;
    users: AdminUser[];
    nextOffset: number | null;
  }>();
  const [loadingMore, setLoadingMore] = useState(false);
  const search = useDebounced(query);
  const path = `/users?${new URLSearchParams({ query: search, status }).toString()}`;
  const { data, error, reload } = useAdminResource<UserPage>(path);
  const organizations = useAdminResource<{
    organizations: AdminOrganization[];
  }>("/organizations");
  const more = data && later?.after === data ? later.users : [];
  const nextOffset =
    data && later?.after === data
      ? later.nextOffset
      : (data?.nextOffset ?? null);
  const loadMore = async () => {
    if (nextOffset === null || !data) return;
    setLoadingMore(true);
    try {
      const page = await adminRequest<UserPage>(
        `/users?${new URLSearchParams({ query: search, status, offset: String(nextOffset) }).toString()}`,
      );
      setLater({
        after: data,
        users: [...more, ...page.users],
        nextOffset: page.nextOffset,
      });
    } catch {
      // The button stays; the next click tries again.
    } finally {
      setLoadingMore(false);
    }
  };
  const users = [...(data?.users ?? []), ...more];
  return (
    <SettingsSection
      id="people"
      icon={<Users />}
      title="People"
      description="Every account on this installation. Deactivating signs a person out everywhere and keeps their history; reactivating restores access."
      action={
        <Button size="sm" onClick={() => setCreating((c) => !c)}>
          <UserPlus className="size-3.5" /> New account
        </Button>
      }
    >
      {creating && (
        <CreateAccount
          organizations={organizations.data?.organizations ?? []}
          onCancel={() => setCreating(false)}
          onCreated={(text) => {
            setCreating(false);
            setNotice(text);
            reload();
            organizations.reload();
          }}
        />
      )}
      {notice && (
        <SettingsBody className="py-2.5">
          <p
            role="status"
            className="text-[13px] text-emerald-700 dark:text-emerald-400"
          >
            {notice}
          </p>
        </SettingsBody>
      )}
      <SettingsBody className="flex flex-wrap items-end gap-3 border-t border-border py-3">
        <label className="block min-w-56 flex-1 text-[13px] font-medium">
          Search
          <Input
            type="search"
            placeholder="Name, email or handle"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            className={fieldClass}
          />
        </label>
        <div className="text-[13px] font-medium">
          <span id="people-status-label">Show</span>
          <DropdownSelect
            aria-labelledby="people-status-label"
            className="mt-1.5 w-40"
            value={status}
            onValueChange={setStatus}
          >
            {statuses.map((s) => (
              <DropdownSelectOption key={s.value} value={s.value}>
                {s.label}
              </DropdownSelectOption>
            ))}
          </DropdownSelect>
        </div>
      </SettingsBody>
      <div className="border-t border-border">
        {error && !data ? (
          <SettingsBody>
            <InlineError>{error}</InlineError>
          </SettingsBody>
        ) : !data ? (
          <p className="px-5 py-6 text-center text-[13px] text-muted-foreground">
            Loading…
          </p>
        ) : (
          <SettingsList
            isEmpty={users.length === 0}
            empty={search ? "Nobody matches this search." : "No accounts yet."}
          >
            {users.map((user) => (
              <PersonRow
                key={user.id}
                user={user}
                self={user.id === me.id}
                organizations={organizations.data?.organizations ?? []}
                onChanged={() => {
                  reload();
                  organizations.reload();
                }}
              />
            ))}
          </SettingsList>
        )}
      </div>
      {data && (
        <div className="flex items-center justify-between border-t border-border px-5 py-3 text-xs text-muted-foreground">
          <span>
            {data.total} {data.total === 1 ? "account" : "accounts"}
          </span>
          {nextOffset !== null && (
            <Button
              size="sm"
              variant="ghost"
              disabled={loadingMore}
              onClick={() => void loadMore()}
            >
              {loadingMore ? "Loading…" : "Show more"}
            </Button>
          )}
        </div>
      )}
    </SettingsSection>
  );
}

function OrganizationRolePicker({
  organizations,
  organizationId,
  role,
  onChange,
  allowNone,
  idPrefix,
}: {
  organizations: AdminOrganization[];
  organizationId: string;
  role: Role;
  onChange: (next: { organizationId: string; role: Role }) => void;
  allowNone: boolean;
  idPrefix: string;
}) {
  return (
    <>
      <div className="text-[13px] font-medium">
        <span id={`${idPrefix}-organization-label`}>Organization</span>
        <DropdownSelect
          aria-labelledby={`${idPrefix}-organization-label`}
          className="mt-1.5 w-56"
          value={organizationId}
          onValueChange={(value) => onChange({ organizationId: value, role })}
        >
          {allowNone && (
            <DropdownSelectOption value="none">
              No organization yet
            </DropdownSelectOption>
          )}
          {organizations.map((o) => (
            <DropdownSelectOption key={o.id} value={o.id}>
              {o.name}
            </DropdownSelectOption>
          ))}
        </DropdownSelect>
      </div>
      {organizationId !== "none" && (
        <div className="text-[13px] font-medium">
          <span id={`${idPrefix}-role-label`}>Role</span>
          <DropdownSelect
            aria-labelledby={`${idPrefix}-role-label`}
            className="mt-1.5 w-40"
            value={role}
            onValueChange={(value) =>
              onChange({ organizationId, role: value as Role })
            }
          >
            {roles.map((r) => (
              <DropdownSelectOption key={r.value} value={r.value}>
                {r.label}
              </DropdownSelectOption>
            ))}
          </DropdownSelect>
        </div>
      )}
    </>
  );
}

function CreateAccount({
  organizations,
  onCancel,
  onCreated,
}: {
  organizations: AdminOrganization[];
  onCancel: () => void;
  onCreated: (notice: string) => void;
}) {
  const [membership, setMembership] = useState<{
    organizationId: string;
    role: Role;
  }>({ organizationId: "none", role: "member" });
  const [instanceAdmin, setInstanceAdmin] = useState(false);
  const [error, setError] = useState<string>();
  const [pending, setPending] = useState(false);
  const submit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    const password = formValue(form, "password");
    setPending(true);
    setError(undefined);
    try {
      const result = await adminRequest<{
        user: { email: string };
        organization: { name: string } | null;
      }>("/users", {
        method: "POST",
        body: {
          name: formValue(form, "name"),
          email: formValue(form, "email"),
          ...(password && { password }),
          instanceAdmin,
          ...(membership.organizationId !== "none" && {
            organization: {
              id: membership.organizationId,
              role: membership.role,
            },
          }),
        },
      });
      onCreated(
        `Created ${result.user.email}${result.organization ? ` in ${result.organization.name}` : ""}. ${
          password
            ? "Share the password with them privately; they can change it in Account settings."
            : "They sign in with single sign-on, or choose a password with “Forgot password”."
        }`,
      );
    } catch (e) {
      setError(message(e));
    } finally {
      setPending(false);
    }
  };
  return (
    <form
      onSubmit={(e) => void submit(e)}
      aria-label="New account"
      className="space-y-4 border-t border-border bg-muted/30 px-5 py-4"
    >
      <div className="grid gap-3 sm:grid-cols-2">
        <label className="block text-[13px] font-medium">
          Full name
          <Input
            name="name"
            required
            autoComplete="off"
            className={fieldClass}
          />
        </label>
        <label className="block text-[13px] font-medium">
          Work email
          <Input
            name="email"
            type="email"
            required
            autoComplete="off"
            className={fieldClass}
          />
        </label>
        <label className="block text-[13px] font-medium sm:col-span-2">
          Initial password{" "}
          <span className="font-normal text-muted-foreground">(optional)</span>
          <Input
            name="password"
            type="password"
            autoComplete="new-password"
            minLength={10}
            className={fieldClass}
          />
          <span className="mt-1 block text-xs font-normal text-muted-foreground">
            At least 10 characters, no spaces. Leave empty for people who sign
            in with single sign-on or will use “Forgot password”.
          </span>
        </label>
      </div>
      <div className="flex flex-wrap items-end gap-3">
        <OrganizationRolePicker
          idPrefix="new-account"
          organizations={organizations}
          allowNone
          {...membership}
          onChange={setMembership}
        />
      </div>
      <label className="flex items-start gap-2 text-[13px]">
        <input
          type="checkbox"
          checked={instanceAdmin}
          onChange={(e) => setInstanceAdmin(e.target.checked)}
          className="mt-0.5"
        />
        <span>
          <span className="font-medium">Instance administrator</span>
          <span className="block text-xs text-muted-foreground">
            Can open this console and manage every account and organization.
          </span>
        </span>
      </label>
      <InlineError>{error}</InlineError>
      <div className="flex gap-2">
        <Button type="submit" disabled={pending}>
          {pending ? "Creating…" : "Create account"}
        </Button>
        <Button type="button" variant="ghost" onClick={onCancel}>
          Cancel
        </Button>
      </div>
    </form>
  );
}

function PersonRow({
  user,
  self,
  organizations,
  onChanged,
}: {
  user: AdminUser;
  self: boolean;
  organizations: AdminOrganization[];
  onChanged: () => void;
}) {
  const [open, setOpen] = useState(false);
  return (
    <div data-testid="admin-person" className="text-[13px]">
      <div className="flex flex-wrap items-center gap-3 px-5 py-3">
        <Avatar name={user.name || user.email} image={user.image} size="sm" />
        <div className="min-w-0 flex-1">
          <p className="flex flex-wrap items-center gap-1.5 font-medium">
            <span className="truncate">{user.name || user.email}</span>
            {self && <Badge>You</Badge>}
            {user.instanceAdmin && <Badge tone="info">Administrator</Badge>}
            {user.deletedAt ? (
              <Badge tone="danger">Deleted</Badge>
            ) : (
              <>
                {user.deactivatedAt && <Badge tone="danger">Deactivated</Badge>}
                {!user.emailVerified && (
                  <Badge tone="warning">Unverified</Badge>
                )}
              </>
            )}
          </p>
          {user.deletedAt ? (
            <p className="truncate text-xs text-muted-foreground">
              Deleted by its owner {date(user.deletedAt)}. Only the name is
              kept, for history.
            </p>
          ) : (
            <p className="truncate text-xs text-muted-foreground">
              {user.email}
              {user.handle && ` · @${user.handle}`}
              {" · "}
              {user.organizations.length
                ? user.organizations
                    .map((o) => `${o.name} (${o.role})`)
                    .join(", ")
                : "no organization"}
            </p>
          )}
        </div>
        <p className="hidden text-xs text-muted-foreground sm:block">
          {user.lastActiveAt
            ? `Active ${date(user.lastActiveAt)}`
            : `Created ${date(user.createdAt)}`}
        </p>
        {!user.deletedAt && (
          <Button
            size="sm"
            variant="secondary"
            aria-expanded={open}
            aria-label={`Manage ${user.name || user.email}`}
            onClick={() => setOpen((o) => !o)}
          >
            Manage
          </Button>
        )}
      </div>
      {open && !user.deletedAt && (
        <ManagePerson
          user={user}
          self={self}
          organizations={organizations.filter(
            (o) => !user.organizations.some((m) => m.id === o.id),
          )}
          onChanged={onChanged}
        />
      )}
    </div>
  );
}

function ManagePerson({
  user,
  self,
  organizations,
  onChanged,
}: {
  user: AdminUser;
  self: boolean;
  organizations: AdminOrganization[];
  onChanged: () => void;
}) {
  const [busy, setBusy] = useState<string>();
  const [error, setError] = useState<string>();
  const [done, setDone] = useState<string>();
  const [confirmDeactivate, setConfirmDeactivate] = useState(false);
  const [password, setPassword] = useState("");
  const [membership, setMembership] = useState<{
    organizationId: string;
    role: Role;
  }>({ organizationId: organizations[0]?.id ?? "none", role: "member" });
  const act = async (
    name: string,
    path: string,
    body: unknown,
    success: string,
  ) => {
    setBusy(name);
    setError(undefined);
    setDone(undefined);
    try {
      await adminRequest(`/users/${encodeURIComponent(user.id)}${path}`, {
        method: "POST",
        body,
      });
      setDone(success);
      onChanged();
    } catch (e) {
      setError(message(e));
    } finally {
      setBusy(undefined);
    }
  };
  const label = user.name || user.email;
  return (
    <div className="space-y-4 border-t border-border bg-muted/30 px-5 py-4">
      <div className="flex flex-wrap gap-2">
        <Button
          size="sm"
          variant="secondary"
          disabled={Boolean(busy) || Boolean(user.deactivatedAt)}
          onClick={() =>
            void act(
              "admin",
              "/administrator",
              { instanceAdmin: !user.instanceAdmin },
              user.instanceAdmin
                ? `${label} is no longer an instance administrator.`
                : `${label} is an instance administrator.`,
            )
          }
        >
          <ShieldUser className="size-3.5" />
          {user.instanceAdmin ? "Remove administrator" : "Make administrator"}
        </Button>
        <Button
          size="sm"
          variant="secondary"
          disabled={Boolean(busy) || Boolean(user.deactivatedAt)}
          onClick={() =>
            void act(
              "reset",
              "/password-reset",
              {},
              `A password reset link was sent to ${user.email}.`,
            )
          }
        >
          <Mail className="size-3.5" /> Send password reset link
        </Button>
        {user.deactivatedAt ? (
          <Button
            size="sm"
            disabled={Boolean(busy)}
            onClick={() =>
              void act(
                "reactivate",
                "/deactivation",
                { deactivated: false },
                `${label} can sign in again.`,
              )
            }
          >
            Reactivate
          </Button>
        ) : (
          !self &&
          (confirmDeactivate ? (
            <>
              <Button
                size="sm"
                variant="danger"
                disabled={Boolean(busy)}
                onClick={() =>
                  void act(
                    "deactivate",
                    "/deactivation",
                    { deactivated: true },
                    `${label} is deactivated and signed out everywhere.`,
                  ).then(() => setConfirmDeactivate(false))
                }
              >
                Confirm: deactivate {label}
              </Button>
              <Button
                size="sm"
                variant="ghost"
                onClick={() => setConfirmDeactivate(false)}
              >
                Keep active
              </Button>
            </>
          ) : (
            <Button
              size="sm"
              variant="outline"
              disabled={Boolean(busy)}
              onClick={() => setConfirmDeactivate(true)}
            >
              Deactivate…
            </Button>
          ))
        )}
      </div>
      <form
        className="flex flex-wrap items-end gap-3"
        onSubmit={(e) => {
          e.preventDefault();
          void act(
            "password",
            "/password",
            { password },
            `New password set for ${label}; their sessions were signed out.`,
          ).then(() => setPassword(""));
        }}
      >
        <label className="block min-w-56 text-[13px] font-medium">
          Set a new password
          <Input
            type="password"
            autoComplete="new-password"
            value={password}
            minLength={10}
            onChange={(e) => setPassword(e.target.value)}
            className={fieldClass}
          />
        </label>
        <Button
          type="submit"
          size="sm"
          variant="secondary"
          disabled={Boolean(busy) || password.length < 10}
        >
          Set password
        </Button>
      </form>
      {organizations.length > 0 && (
        <form
          className="flex flex-wrap items-end gap-3"
          onSubmit={(e) => {
            e.preventDefault();
            setBusy("member");
            setError(undefined);
            setDone(undefined);
            adminRequest<{ organization: { name: string } }>(
              `/organizations/${encodeURIComponent(membership.organizationId)}/members`,
              {
                method: "POST",
                body: { userId: user.id, role: membership.role },
              },
            )
              .then((result) => {
                setDone(`${label} joined ${result.organization.name}.`);
                onChanged();
              })
              .catch((e: unknown) => setError(message(e)))
              .finally(() => setBusy(undefined));
          }}
        >
          <OrganizationRolePicker
            idPrefix={`member-${user.id}`}
            organizations={organizations}
            allowNone={false}
            {...membership}
            onChange={setMembership}
          />
          <Button
            type="submit"
            size="sm"
            variant="secondary"
            disabled={Boolean(busy) || membership.organizationId === "none"}
          >
            Add to organization
          </Button>
        </form>
      )}
      <InlineError>{error}</InlineError>
      {done && (
        <p
          role="status"
          className="text-xs text-emerald-700 dark:text-emerald-400"
        >
          {done}
        </p>
      )}
    </div>
  );
}

// ------------------------------------------------------------- organizations

function Organizations() {
  const { data, error, reload } = useAdminResource<{
    organizations: AdminOrganization[];
  }>("/organizations");
  const [creating, setCreating] = useState(false);
  const [notice, setNotice] = useState<string>();
  if (error && !data) return <LoadFailure error={error} retry={reload} />;
  return (
    <SettingsSection
      id="organizations"
      icon={<Building2 />}
      title="Organizations"
      description="Each organization owns its projects, members and settings. Its owners and administrators run it from Organization settings; you create it and choose its first owner."
      action={
        <Button size="sm" onClick={() => setCreating((c) => !c)}>
          <Building2 className="size-3.5" /> New organization
        </Button>
      }
    >
      {creating && (
        <CreateOrganization
          onCancel={() => setCreating(false)}
          onCreated={(text) => {
            setCreating(false);
            setNotice(text);
            reload();
          }}
        />
      )}
      {notice && (
        <SettingsBody className="py-2.5">
          <p
            role="status"
            className="text-[13px] text-emerald-700 dark:text-emerald-400"
          >
            {notice}
          </p>
        </SettingsBody>
      )}
      <div className="border-t border-border">
        {!data ? (
          <p className="px-5 py-6 text-center text-[13px] text-muted-foreground">
            Loading…
          </p>
        ) : (
          <SettingsList
            isEmpty={data.organizations.length === 0}
            empty="No organizations yet. Create the first one and choose its owner."
          >
            {data.organizations.map((o) => (
              <OrganizationRow key={o.id} organization={o} onChanged={reload} />
            ))}
          </SettingsList>
        )}
      </div>
    </SettingsSection>
  );
}

function CreateOrganization({
  onCancel,
  onCreated,
}: {
  onCancel: () => void;
  onCreated: (notice: string) => void;
}) {
  const me = useSessionUser();
  const [name, setName] = useState("");
  const [handle, setHandle] = useState<string | null>(null);
  const [owner, setOwner] = useState(me.email);
  const [error, setError] = useState<string>();
  const [pending, setPending] = useState(false);
  const handleValue = handle ?? suggestOrganizationHandle(name);
  const submit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setPending(true);
    setError(undefined);
    try {
      const result = await adminRequest<{
        organization: { name: string; slug: string };
      }>("/organizations", {
        method: "POST",
        body: {
          name,
          slug: normalizeOrganizationHandle(handleValue),
          owner: { email: owner },
        },
      });
      onCreated(
        `Created ${result.organization.name} (/${result.organization.slug}) owned by ${owner}. Its owner sets up the first project and invites the team.`,
      );
    } catch (e) {
      setError(message(e));
    } finally {
      setPending(false);
    }
  };
  return (
    <form
      onSubmit={(e) => void submit(e)}
      aria-label="New organization"
      className="space-y-4 border-t border-border bg-muted/30 px-5 py-4"
    >
      <div className="grid gap-3 sm:grid-cols-2">
        <label className="block text-[13px] font-medium">
          Organization name
          <Input
            required
            maxLength={80}
            value={name}
            onChange={(e) => setName(e.target.value)}
            className={fieldClass}
          />
        </label>
        <label className="block text-[13px] font-medium">
          Handle
          <Input
            required
            value={handleValue}
            onChange={(e) => setHandle(e.target.value)}
            className={fieldClass}
          />
          <span className="mt-1 block text-xs font-normal text-muted-foreground">
            Its address: {window.location.host}/
            {normalizeOrganizationHandle(handleValue) || "…"}
          </span>
        </label>
        <label className="block text-[13px] font-medium sm:col-span-2">
          Owner’s email
          <Input
            type="email"
            required
            value={owner}
            onChange={(e) => setOwner(e.target.value)}
            className={fieldClass}
          />
          <span className="mt-1 block text-xs font-normal text-muted-foreground">
            An existing account. Create it under People first if needed.
          </span>
        </label>
      </div>
      <InlineError>{error}</InlineError>
      <div className="flex gap-2">
        <Button type="submit" disabled={pending}>
          {pending ? "Creating…" : "Create organization"}
        </Button>
        <Button type="button" variant="ghost" onClick={onCancel}>
          Cancel
        </Button>
      </div>
    </form>
  );
}

function OrganizationRow({
  organization,
  onChanged,
}: {
  organization: AdminOrganization;
  onChanged: () => void;
}) {
  const [adding, setAdding] = useState(false);
  const [email, setEmail] = useState("");
  const [role, setRole] = useState<Role>("member");
  const [error, setError] = useState<string>();
  const [done, setDone] = useState<string>();
  const [pending, setPending] = useState(false);
  const submit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setPending(true);
    setError(undefined);
    setDone(undefined);
    try {
      await adminRequest(
        `/organizations/${encodeURIComponent(organization.id)}/members`,
        { method: "POST", body: { email, role } },
      );
      setDone(`${email} joined ${organization.name}.`);
      setEmail("");
      onChanged();
    } catch (e) {
      setError(message(e));
    } finally {
      setPending(false);
    }
  };
  return (
    <div data-testid="admin-organization" className="text-[13px]">
      <div className="flex flex-wrap items-center gap-3 px-5 py-3">
        <span
          aria-hidden
          className="grid size-8 shrink-0 place-items-center rounded-lg bg-primary/10 text-sm font-semibold text-primary"
        >
          {organization.name.slice(0, 1).toUpperCase()}
        </span>
        <div className="min-w-0 flex-1">
          <p className="flex items-center gap-2 truncate font-medium">
            {organization.name}
            {organization.deletion && (
              <Badge tone="danger">
                {organization.deletion.status === "deleting"
                  ? "Being deleted"
                  : `Deletion scheduled for ${date(organization.deletion.deleteAfter)}`}
              </Badge>
            )}
          </p>
          {organization.deletion?.error && (
            <p className="text-xs text-destructive">
              {organization.deletion.error}
            </p>
          )}
          <p className="truncate text-xs text-muted-foreground">
            /{organization.slug} · {organization.members}{" "}
            {organization.members === 1 ? "member" : "members"}
            {organization.pendingInvitations > 0 &&
              ` · ${organization.pendingInvitations} invited`}
            {" · "}
            {organization.owners.length
              ? `owned by ${organization.owners.map((o) => o.name || o.email).join(", ")}`
              : "no owner"}
          </p>
        </div>
        <p className="hidden text-xs text-muted-foreground sm:block">
          Created {date(organization.createdAt)}
        </p>
        <Button
          size="sm"
          variant="secondary"
          aria-expanded={adding}
          onClick={() => setAdding((a) => !a)}
        >
          Add member
        </Button>
      </div>
      {adding && (
        <form
          onSubmit={(e) => void submit(e)}
          aria-label={`Add a member to ${organization.name}`}
          className="flex flex-wrap items-end gap-3 border-t border-border bg-muted/30 px-5 py-4"
        >
          <label className="block min-w-56 flex-1 text-[13px] font-medium">
            Email of an existing account
            <Input
              type="email"
              required
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              className={fieldClass}
            />
          </label>
          <div className="text-[13px] font-medium">
            <span id={`org-${organization.id}-role`}>Role</span>
            <DropdownSelect
              aria-labelledby={`org-${organization.id}-role`}
              className="mt-1.5 w-40"
              value={role}
              onValueChange={(value) => setRole(value as Role)}
            >
              {roles.map((r) => (
                <DropdownSelectOption key={r.value} value={r.value}>
                  {r.label}
                </DropdownSelectOption>
              ))}
            </DropdownSelect>
          </div>
          <Button type="submit" size="sm" disabled={pending}>
            {pending ? "Adding…" : "Add"}
          </Button>
          <div className="w-full">
            <InlineError>{error}</InlineError>
            {done && (
              <p
                role="status"
                className="text-xs text-emerald-700 dark:text-emerald-400"
              >
                {done}
              </p>
            )}
          </div>
        </form>
      )}
    </div>
  );
}

// ------------------------------------------------------------------ activity

function ActivityLog() {
  const { data, error, reload } = useAdminResource<ActivityPage>("/activity");
  const [later, setLater] = useState<{
    after: ActivityPage;
    events: ActivityPage["events"];
    before: string | null;
  }>();
  const [loading, setLoading] = useState(false);
  const older = data && later?.after === data ? later.events : [];
  const before =
    data && later?.after === data ? later.before : (data?.before ?? null);
  if (error && !data) return <LoadFailure error={error} retry={reload} />;
  const events = [...(data?.events ?? []), ...older];
  return (
    <SettingsSection
      id="activity"
      icon={<Activity />}
      title="Activity"
      description="Accounts created, deactivated and reactivated, administrators granted and removed, and organizations created, in this console or on the server. Entries cannot be edited or deleted."
    >
      {!data ? (
        <p className="px-5 py-6 text-center text-[13px] text-muted-foreground">
          Loading…
        </p>
      ) : (
        <SettingsList
          isEmpty={events.length === 0}
          empty="Nothing recorded yet."
        >
          {events.map((event) => (
            <div
              key={event.id}
              data-testid="admin-activity"
              className="px-5 py-2.5 text-[13px]"
            >
              <div className="flex flex-wrap items-baseline gap-x-2 gap-y-0.5">
                <span className="font-medium">
                  {event.actor?.name ??
                    (event.via === "cli" ? "Server command line" : "Lictory")}
                </span>
                <span className="min-w-0 flex-1">
                  {event.label}
                  {event.target?.label && (
                    <span className="text-muted-foreground">
                      {" "}
                      · {event.target.label}
                    </span>
                  )}
                </span>
                <time
                  dateTime={event.createdAt}
                  className="shrink-0 text-xs text-muted-foreground tabular-nums"
                >
                  {dateTime(event.createdAt)}
                </time>
              </div>
              <div className="mt-0.5 flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
                <Badge>
                  {event.via === "cli" ? "Server" : "Admin console"}
                </Badge>
                {event.actor?.email && <span>{event.actor.email}</span>}
              </div>
            </div>
          ))}
        </SettingsList>
      )}
      {before && (
        <div className="border-t border-border px-5 py-3 text-center">
          <Button
            size="sm"
            variant="ghost"
            disabled={loading}
            onClick={() => {
              if (!data) return;
              setLoading(true);
              void adminRequest<ActivityPage>(
                `/activity?before=${encodeURIComponent(before)}`,
              )
                .then((page) =>
                  setLater({
                    after: data,
                    events: [...older, ...page.events],
                    before: page.before,
                  }),
                )
                .catch(() => undefined)
                .finally(() => setLoading(false));
            }}
          >
            {loading ? "Loading…" : "Show older entries"}
          </Button>
        </div>
      )}
    </SettingsSection>
  );
}
