"use client";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useState, useSyncExternalStore } from "react";
import {
  FileText,
  CheckCheck,
  Settings2,
  Layers3,
  WifiOff,
} from "lucide-react";
import { authClient } from "~/lib/auth-client";
import { Button } from "~/components/ui/button";
import {
  ActionForm,
  Avatar,
  Badge,
  ConfirmButton,
  Dialog,
  EmptyState,
  Field,
  Panel,
} from "~/components/ui/workspace";
import { SyncEngine } from "~/sync/client/engine";
import type { Command, Directory, Entity, Scope } from "~/sync/shared/protocol";
import { href, value } from "./workspace-navigation";
import { ProposalWorkspace } from "./proposal-workspace";
export function Workspace({
  userId,
  initialDirectory,
  scope,
  tab,
}: {
  userId: string;
  initialDirectory: Directory;
  scope?: Scope;
  tab: string;
}) {
  const router = useRouter();
  if (!scope)
    return (
      <main className="mx-auto max-w-xl px-5 py-20">
        <Layers3 className="mb-5 size-8 text-primary" />
        <h1 className="text-2xl font-semibold">
          A shared space for clearer requirements
        </h1>
        <p className="my-4 text-muted-foreground">
          Create your organization, then bring your first proposal into review.
        </p>
        <ActionForm
          label="Create organization"
          submit={async (data) => {
            const result = await authClient.organization.create({
              name: value(data, "name"),
              slug: `${value(data, "name")
                .toLowerCase()
                .replace(
                  /[^a-z0-9]+/g,
                  "-",
                )}-${crypto.randomUUID().slice(0, 8)}`,
            });
            if (result.error) throw new Error(result.error.message);
            router.refresh();
          }}
        >
          <Field name="name" label="Organization name" />
        </ActionForm>
      </main>
    );
  return (
    <ConnectedWorkspace
      userId={userId}
      initialDirectory={initialDirectory}
      scope={scope}
      tab={tab}
    />
  );
}
function ConnectedWorkspace({
  userId,
  initialDirectory,
  scope,
  tab,
}: {
  userId: string;
  initialDirectory: Directory;
  scope: Scope;
  tab: string;
}) {
  const [engine] = useState(() => new SyncEngine(userId, scope));
  const view = useSyncExternalStore(
    engine.subscribe,
    engine.getSnapshot,
    engine.getSnapshot,
  );
  useEffect(() => {
    void engine.start();
    return () => engine.stop();
  }, [engine]);
  const router = useRouter();
  const roster = view.directory.organizations.length
    ? view.directory
    : initialDirectory;
  const entities = Object.values(view.entities);
  const proposals = entities.filter(
    (e): e is Extract<Entity, { type: "proposal" }> =>
      e.type === "proposal" && e.productId === scope.productId,
  );
  const proposal = proposals.find((p) => p.id === scope.proposalId);
  const mutate = (command: Command) => engine.mutate(command);
  const [showArchived, setShowArchived] = useState(false);
  const [navigationOpen, setNavigationOpen] = useState(false);
  const isAdmin = roster.organizations
    .find((o) => o.id === scope.organizationId)
    ?.role.split(",")
    .some((r) => r === "owner" || r === "admin");
  return (
    <div className="min-h-[calc(100dvh-73px)] lg:grid lg:grid-cols-[220px_minmax(0,1fr)]">
      <aside className="border-b bg-muted/30 p-4 lg:border-r lg:border-b-0">
        <Button
          variant="secondary"
          className="w-full lg:hidden"
          aria-expanded={navigationOpen}
          onClick={() => setNavigationOpen(!navigationOpen)}
        >
          Workspace navigation
        </Button>
        <div
          className={`${navigationOpen ? "mt-4 block" : "hidden"} space-y-6 lg:mt-0 lg:block`}
        >
          <Field
            label="Organization"
            name="organization"
            value={scope.organizationId}
            onChange={(id) => router.push(`/app?org=${encodeURIComponent(id)}`)}
          >
            {roster.organizations.map((o) => (
              <option key={o.id} value={o.id}>
                {o.name}
              </option>
            ))}
          </Field>
          <div>
            <p className="mb-2 px-2 text-xs font-medium text-muted-foreground">
              PRODUCTS
            </p>
            {roster.products.map((p) => (
              <Link
                key={p.id}
                href={href({ ...scope, productId: p.id })}
                className={`flex items-center gap-2 rounded-lg px-3 py-2.5 text-sm ${p.id === scope.productId ? "bg-card font-semibold shadow-[var(--shadow-border)]" : "text-muted-foreground hover:bg-muted"}`}
              >
                <Layers3 className="size-4" />
                {p.name}
              </Link>
            ))}
          </div>
          <nav aria-label="Workspace" className="space-y-1">
            {[
              { id: "proposals", name: "Proposals", Icon: FileText },
              { id: "reviews", name: "Reviews", Icon: CheckCheck },
              { id: "settings", name: "Settings", Icon: Settings2 },
            ].map(({ id, name, Icon }) => (
              <Link
                key={id}
                href={href(scope, id)}
                aria-current={tab === id ? "page" : undefined}
                className={`flex items-center gap-3 rounded-lg px-3 py-2.5 text-sm ${tab === id ? "bg-primary/8 font-medium text-primary" : "text-muted-foreground hover:bg-muted"}`}
              >
                <Icon className="size-4" />
                {name}
              </Link>
            ))}
          </nav>
          <div
            className="border-t pt-4 text-xs text-muted-foreground"
            role="status"
          >
            {view.status === "offline" && <WifiOff className="mb-1 size-4" />}
            {view.pending.length
              ? `${view.pending.length} changes pending`
              : view.status === "synced"
                ? "All changes synced"
                : view.status === "hydrating"
                  ? "Opening local workspace…"
                  : view.status === "syncing"
                    ? "Synchronizing…"
                    : view.status === "offline"
                      ? "Offline · showing saved data"
                      : "Sync needs attention"}
          </div>
          {process.env.NODE_ENV === "development" && (
            <details className="text-xs text-muted-foreground">
              <summary className="cursor-pointer">Sync inspector</summary>
              <pre className="mt-2 break-all whitespace-pre-wrap">
                {JSON.stringify(
                  {
                    checkpoint: view.cursor,
                    state: view.status,
                    pending: view.pending.length,
                    entities: entities.length,
                    lastSync: view.lastSync,
                    error: view.error,
                  },
                  null,
                  2,
                )}
              </pre>
            </details>
          )}
        </div>
      </aside>
      <main className="min-w-0">
        {view.error && (
          <div
            role="alert"
            className="flex flex-wrap items-center gap-3 border-b bg-amber-500/10 px-6 py-3 text-sm"
          >
            <span>{view.error}</span>
            <Button variant="ghost" onClick={() => void engine.sync()}>
              Reconnect
            </Button>
            <Button variant="ghost" onClick={() => void engine.reset()}>
              Reload server state
            </Button>
          </div>
        )}
        {view.pending
          .filter((q) => q.error)
          .map((q) => (
            <div key={q.mutation.id} className="space-y-2 border-b p-4 text-sm">
              <p>
                {q.mutation.command.type}: {q.error}
              </p>
              <details>
                <summary>Inspect unsaved change</summary>
                <pre className="max-h-48 overflow-auto whitespace-pre-wrap">
                  {JSON.stringify(q.mutation.command, null, 2)}
                </pre>
              </details>
              <Button
                variant="secondary"
                onClick={() => void engine.retry(q.mutation.id)}
              >
                Retry
              </Button>{" "}
              <ConfirmButton
                message="Discard this unsaved change?"
                action={() => engine.discard(q.mutation.id)}
              >
                Discard
              </ConfirmButton>
            </div>
          ))}
        {scope.proposalId ? (
          proposal ? (
            <ProposalWorkspace
              proposal={proposal}
              entities={entities}
              scope={scope}
              view={view}
              userId={userId}
              mutate={mutate}
            />
          ) : (
            <div className="p-8">
              <EmptyState
                title={
                  view.status === "failed"
                    ? "Proposal unavailable"
                    : "Opening proposal…"
                }
              >
                Your saved workspace remains available from the navigation.
              </EmptyState>
            </div>
          )
        ) : (
          <>
            <header className="flex flex-wrap items-center justify-between gap-4 border-b px-6 py-5">
              <div>
                <p className="text-xs text-muted-foreground">
                  {roster.products.find((p) => p.id === scope.productId)
                    ?.name ?? "Get started"}
                </p>
                <h1 className="mt-1 text-xl font-semibold">
                  {tab === "reviews"
                    ? "Review inbox"
                    : tab === "settings"
                      ? "Workspace settings"
                      : "Proposals"}
                </h1>
              </div>
              {tab === "proposals" && scope.productId !== undefined && (
                <Dialog title="Create proposal" trigger="New proposal">
                  {(close) => (
                    <ActionForm
                      label="Create proposal"
                      onDone={close}
                      submit={async (data) => {
                        const proposalId = crypto.randomUUID();
                        await mutate({
                          type: "createProposal",
                          productId: scope.productId!,
                          proposalId,
                          title: value(data, "title"),
                          problem: value(data, "problem"),
                        });
                        await engine.sync();
                        if (
                          !engine
                            .getSnapshot()
                            .pending.some(
                              (q) =>
                                q.mutation.command.type === "createProposal" &&
                                q.mutation.command.proposalId === proposalId,
                            )
                        )
                          router.push(href(scope, "proposals", proposalId));
                      }}
                    >
                      <Field
                        label="Title"
                        name="title"
                        placeholder="What should change?"
                      />
                      <Field
                        label="Problem / intent"
                        name="problem"
                        multiline
                        placeholder="Who needs this, and why?"
                      />
                      <p className="text-xs text-muted-foreground">
                        Start rough. Refine the behavior together.
                      </p>
                    </ActionForm>
                  )}
                </Dialog>
              )}
            </header>
            <div className="p-6">
              {tab === "settings" || scope.productId === undefined ? (
                <div className="max-w-xl space-y-8">
                  <Panel title="Product">
                    {isAdmin ? (
                      <ActionForm
                        label={
                          scope.productId === undefined
                            ? "Create product"
                            : "Rename product"
                        }
                        submit={async (data) => {
                          await mutate(
                            scope.productId === undefined
                              ? {
                                  type: "createProduct",
                                  name: value(data, "name"),
                                  slug: crypto.randomUUID(),
                                }
                              : {
                                  type: "renameProduct",
                                  productId: scope.productId,
                                  name: value(data, "name"),
                                },
                          );
                          await engine.sync();
                          router.refresh();
                        }}
                      >
                        <Field
                          label="Product name"
                          name="name"
                          value={
                            roster.products.find(
                              (p) => p.id === scope.productId,
                            )?.name
                          }
                        />
                      </ActionForm>
                    ) : (
                      <p className="text-sm text-muted-foreground">
                        An organization administrator manages products.
                      </p>
                    )}
                  </Panel>
                  {isAdmin && (
                    <OrganizationSettings
                      organizationId={scope.organizationId}
                      name={
                        roster.organizations.find(
                          (o) => o.id === scope.organizationId,
                        )?.name ?? ""
                      }
                    />
                  )}
                  <Panel title="People">
                    {roster.members.map((m) => (
                      <div
                        key={m.id}
                        className="flex items-center gap-2 text-sm"
                      >
                        <Avatar name={m.name} />
                        {m.name}
                      </div>
                    ))}
                    <p className="text-xs text-muted-foreground">
                      All organization members can collaborate on products.
                      Review decisions require an explicit assignment.
                    </p>
                  </Panel>
                  {isAdmin && (
                    <Panel title="Add another product">
                      <ActionForm
                        label="Create product"
                        submit={async (data) => {
                          await mutate({
                            type: "createProduct",
                            name: value(data, "name"),
                            slug: crypto.randomUUID(),
                          });
                          await engine.sync();
                          router.refresh();
                        }}
                      >
                        <Field label="Product name" name="name" />
                      </ActionForm>
                    </Panel>
                  )}
                </div>
              ) : (
                <>
                  <p className="mb-6 max-w-xl text-sm text-muted-foreground">
                    {tab === "reviews"
                      ? "Open a proposal to review its current specification, respond to discussions, and record your decision."
                      : "Turn product intent into a specification your team can commit to."}
                  </p>
                  {tab === "proposals" && (
                    <label className="mb-4 flex items-center gap-2 text-xs text-muted-foreground">
                      <input
                        type="checkbox"
                        checked={showArchived}
                        onChange={(e) => setShowArchived(e.target.checked)}
                      />
                      Show archived proposals
                    </label>
                  )}
                  {view.status === "hydrating" ? (
                    <div
                      className="h-32 animate-pulse rounded-xl bg-muted"
                      aria-label="Loading saved workspace"
                    />
                  ) : proposals.filter((p) => showArchived || !p.archivedAt)
                      .length === 0 ? (
                    <EmptyState title="Your first proposal starts here">
                      Describe a problem. Bring the right people into the
                      conversation.
                    </EmptyState>
                  ) : (
                    <div className="overflow-hidden rounded-xl border bg-card">
                      {proposals
                        .filter(
                          (p) =>
                            (showArchived || !p.archivedAt) &&
                            (tab !== "reviews" ||
                              p.status === "in_review" ||
                              p.status === "changes_requested"),
                        )
                        .map((p) => (
                          <Link
                            href={href(scope, "proposals", p.id)}
                            key={p.id}
                            className="flex items-center justify-between gap-4 border-b p-4 last:border-0 hover:bg-muted/50"
                          >
                            <div className="min-w-0">
                              <p className="truncate text-sm font-medium">
                                {p.title}
                              </p>
                              <p className="mt-1 truncate text-xs text-muted-foreground">
                                {p.problemStatement}
                              </p>
                            </div>
                            <Badge>
                              {p.archivedAt
                                ? "Archived"
                                : p.status.replaceAll("_", " ")}
                            </Badge>
                          </Link>
                        ))}
                    </div>
                  )}
                </>
              )}
            </div>
          </>
        )}
      </main>
    </div>
  );
}

function OrganizationSettings({
  organizationId,
  name,
}: {
  organizationId: string;
  name: string;
}) {
  const router = useRouter();
  const [invitationUrl, setInvitationUrl] = useState<string>();
  return (
    <>
      <Panel title="Organization">
        <ActionForm
          label="Rename organization"
          submit={async (data) => {
            const result = await authClient.organization.update({
              organizationId,
              data: { name: value(data, "name") },
            });
            if (result.error) throw new Error(result.error.message);
            router.refresh();
          }}
        >
          <Field label="Organization name" name="name" value={name} />
        </ActionForm>
      </Panel>
      <Panel title="Invite a teammate">
        <ActionForm
          label="Create invitation link"
          submit={async (data) => {
            const result = await authClient.organization.inviteMember({
              organizationId,
              email: value(data, "email"),
              role: "member",
            });
            if (result.error) throw new Error(result.error.message);
            setInvitationUrl(
              `${window.location.origin}/app/invitation?id=${result.data.id}`,
            );
          }}
        >
          <Field label="Teammate email" name="email" />
          <p className="text-xs text-muted-foreground">
            Share the resulting link with your teammate. They must sign in with
            this email address to accept.
          </p>
        </ActionForm>
        {invitationUrl && (
          <label className="mt-4 block text-xs">
            Invitation link
            <input
              className="mt-2 w-full rounded-lg border bg-card p-2"
              readOnly
              value={invitationUrl}
              onFocus={(event) => event.target.select()}
            />
          </label>
        )}
      </Panel>
    </>
  );
}
