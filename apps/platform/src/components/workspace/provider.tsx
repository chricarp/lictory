import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  useSyncExternalStore,
  type ReactNode,
} from "react";
import { useConnectionState, useQuery, useZero } from "@rocicorp/zero/react";
import { AvatarImages } from "@lictory/ui/avatar";
import { toast } from "@lictory/ui/toast";
import {
  analyticsConfigured,
  clearAnalyticsOrganization,
  identifyUser,
  setAnalyticsOrganization,
  track,
} from "@lictory/core/lib/analytics/client";
import { statusChangeBlocker } from "@lictory/core/contracts/preflight";
import type { Entities } from "@lictory/core/contracts/optimistic";
import { organizationProfileKey } from "@lictory/core/contracts/projection";
import {
  PROTOCOL,
  applicationRoleOf,
  canManageProject,
  capabilitiesOf,
  formerMemberName,
  mutationSchema,
  type Capabilities,
  type Command,
  type Directory,
  type Entity,
  type Mutation,
  noCapabilities,
  type WorkItem,
} from "@lictory/core/contracts/protocol";
import { AI_ACTOR_ID, AI_ACTOR_NAME } from "@lictory/core/contracts/ai";
import {
  byType,
  deliveryIndex,
  myDisciplineIds,
  type Delivery,
  type Label,
  type Milestone,
  type Project,
  type Relation,
} from "@lictory/core/lib/work-items";
import { queries } from "@lictory/zero/queries";
import {
  canWrite,
  viewStatus,
  type ConnectionName,
  type ViewStatus,
} from "@lictory/platform/data/connection";
import {
  createMutationRunner,
  type PendingMutation,
  type Rejection,
} from "@lictory/platform/data/mutations";
import {
  RecoveryStore,
  recoveryKey,
  recoveryText,
} from "@lictory/platform/data/recovery";
import {
  emptyDirectoryProjection,
  useStableEntities,
  useStableValue,
  type DirectoryProjection,
  type OrganizationProfile,
  type SyncRow,
} from "@lictory/platform/data/rows";
import {
  reconnectWorkspace,
  useApplyMutation,
  usePendingTracker,
} from "@lictory/platform/data/zero";

export type Organization = Directory["organizations"][number];

export type View = {
  entities: Entities;
  directory: Directory;
  // Changes sent to the server whose answer has not arrived.
  pending: PendingMutation[];
  status: ViewStatus;
  error?: string;
  // Changes whenever synchronized organization data changes.
  cursor: string;
};

type MutateTarget = Entities | undefined;

type WorkspaceContextValue = {
  userId: string;
  organization: Organization;
  view: View;
  directory: Directory;
  projects: Project[];
  items: WorkItem[];
  labels: Label[];
  milestones: Milestone[];
  relations: Relation[];
  // Teams, types, statuses and iterations indexed from the directory.
  delivery: Delivery;
  // Active disciplines I hold in any project (for "needs my review").
  disciplineIds: string[];
  // Work item capabilities come from my disciplines in one project.
  capabilitiesIn: (projectId: string | null | undefined) => Capabilities;
  // Project configuration: organization administrators and project admins.
  canManage: (projectId: string | null | undefined) => boolean;
  // Application role: administrators manage the organization and every project.
  isAdmin: boolean;
  // Applies a command (optimistically when it is safe) and reports a
  // rejection with a notice. `entities` adds an open item's history for
  // local checks.
  mutate: (
    command: Command,
    entities?: MutateTarget,
  ) => Promise<string | undefined>;
  // Resolves once the server accepted the command; throws MutationRejected.
  mutateConfirmed: (command: Command) => Promise<string>;
  // Sends an exact mutation (a stable ID for an idempotent retry).
  applyConfirmed: (mutation: Mutation) => Promise<string>;
  memberName: (id: string | null | undefined) => string;
  disciplineName: (id: string | null | undefined) => string;
  connection: ConnectionName;
  connectionReason?: string;
  everConnected: boolean;
  reconnect: () => void;
  recovery: RecoveryStore;
  // Keeps an opened item's history synchronized for quick revisits.
  touchItem: (itemId: string) => void;
};
const WorkspaceContext = createContext<WorkspaceContextValue | null>(null);
// Delivery configuration changes far less often than entities; a separate
// context keeps memoized rows from re-rendering on every change.
const DeliveryContext = createContext<Delivery | null>(null);
export function useDelivery() {
  const value = useContext(DeliveryContext);
  if (!value) throw new Error("useDelivery requires WorkspaceProvider.");
  return value;
}

// Recently opened items stay subscribed, so moving between Stories shows
// history that is already local.
const RECENT_ITEMS = 8;
const emptyRows: readonly SyncRow[] = [];
const ITEM_TTL = "5m";

export function emptyDirectory(
  organizations: Directory["organizations"] = [],
): Directory {
  return { organizations, ...emptyDirectoryProjection };
}

// The organization's synchronized rows, shared by the organization layout
// (to decide between setup and the workspace) and the provider.
export function useOrganizationRows(organizationId: string) {
  const [rows, result] = useQuery(queries.organization({ organizationId }));
  return {
    rows: rows as readonly SyncRow[],
    complete: result.type === "complete",
    error: result.type === "error" ? result.error.message : undefined,
  };
}

export function WorkspaceProvider({
  userId,
  organization: membership,
  organizations,
  rows,
  complete,
  queryError,
  children,
}: {
  userId: string;
  organization: Organization;
  organizations: Directory["organizations"];
  rows: readonly SyncRow[];
  complete: boolean;
  queryError?: string;
  children: ReactNode;
}) {
  const zero = useZero();
  const lastOrganization = useRef<string | null>(null);
  useEffect(() => {
    if (!analyticsConfigured()) return;
    identifyUser(userId);
    setAnalyticsOrganization(membership.id);
    if (lastOrganization.current !== membership.id) {
      track("workspace_opened", {
        organization_id: membership.id,
        application_role: membership.role,
      });
      lastOrganization.current = membership.id;
    }
    return () => clearAnalyticsOrganization();
  }, [membership.id, membership.role, userId]);

  const connectionState = useConnectionState();
  const connection: ConnectionName = connectionState.name;
  const connectionReason =
    "reason" in connectionState && typeof connectionState.reason === "string"
      ? connectionState.reason
      : undefined;
  const [everConnected, setEverConnected] = useState(false);
  if (connection === "connected" && !everConnected) setEverConnected(true);

  const entities = useStableEntities(rows);
  const directoryRow = rows.find((r) => r.type === "directory");
  const profileRow = rows.find(
    (r) => r.key === organizationProfileKey(membership.id),
  );
  const projection = directoryRow?.data as DirectoryProjection | undefined;
  const profile = profileRow?.data as OrganizationProfile | undefined;
  // Unchanged content keeps its identity across row updates.
  const directory = useStableValue<Directory>(
    useMemo(
      () => ({ ...emptyDirectoryProjection, ...projection, organizations }),
      [projection, organizations],
    ),
  );
  const cursor = useMemo(
    () => String(rows.reduce((max, r) => Math.max(max, r.updatedAt), 0)),
    [rows],
  );

  const pendingTracker = usePendingTracker();
  const pending = useSyncExternalStore(
    pendingTracker.subscribe,
    pendingTracker.snapshot,
    pendingTracker.snapshot,
  );
  const organizationPending = useMemo(
    () => pending.filter((p) => p.mutation.organizationId === membership.id),
    [pending, membership.id],
  );

  const [recovery] = useState(
    () =>
      new RecoveryStore(
        typeof localStorage === "undefined" ? undefined : localStorage,
        recoveryKey(userId, membership.id),
      ),
  );
  useEffect(() => {
    const onStorage = (event: StorageEvent) => {
      if (event.key === recovery.key) recovery.reload();
    };
    window.addEventListener("storage", onStorage);
    return () => window.removeEventListener("storage", onStorage);
  }, [recovery]);

  const [notified] = useState(() => new Set<string>());
  const notifyRejection = useCallback(
    (rejection: Rejection) => {
      if (notified.has(rejection.mutationId)) return;
      notified.add(rejection.mutationId);
      const text = rejection.recoverable ? recoveryText(rejection.command) : "";
      toast.add({
        title: "Change not applied",
        type: "error",
        id: rejection.mutationId,
        description: rejection.recoverable
          ? `${rejection.message} Your text is kept on this device.`
          : rejection.message,
        timeout: 8000,
        actionProps: text
          ? {
              children: "Copy text",
              onClick: () => void navigator.clipboard?.writeText(text),
            }
          : undefined,
      });
    },
    [notified],
  );

  const apply = useApplyMutation();
  const runner = useMemo(
    () =>
      createMutationRunner({
        apply,
        pending: pendingTracker,
        recovery,
        onRejected: notifyRejection,
      }),
    [apply, pendingTracker, recovery, notifyRejection],
  );

  const entitiesRef = useRef(entities);
  const directoryRef = useRef(directory);
  useEffect(() => {
    entitiesRef.current = entities;
    directoryRef.current = directory;
  }, [entities, directory]);

  const build = useCallback(
    (command: Command) =>
      mutationSchema.parse({
        protocol: PROTOCOL,
        id: crypto.randomUUID(),
        organizationId: membership.id,
        command,
      }),
    [membership.id],
  );

  const mutate = useCallback(
    async (command: Command, target?: MutateTarget) => {
      const blocker =
        command.type === "updateWorkItem" && command.statusId
          ? statusChangeBlocker(
              command,
              target?.[`workItem:${command.workItemId}`]
                ? target
                : entitiesRef.current,
              directoryRef.current,
            )
          : undefined;
      if (blocker) {
        toast.add({
          title: "Change not applied",
          type: "error",
          description: blocker,
          timeout: 8000,
        });
        return;
      }
      return runner.run(build(command));
    },
    [runner, build],
  );
  const mutateConfirmed = useCallback(
    (command: Command) => runner.confirm(build(command)),
    [runner, build],
  );
  const applyConfirmed = useCallback(
    (mutation: Mutation) => runner.confirm(mutation),
    [runner],
  );

  // Recently opened items, kept synchronized until evicted.
  const recent = useRef(new Map<string, () => void>());
  const touchItem = useCallback(
    (itemId: string) => {
      const items = recent.current;
      const existing = items.get(itemId);
      if (existing) {
        items.delete(itemId);
        items.set(itemId, existing);
      } else {
        const { cleanup } = zero.preload(
          queries.workItem({
            organizationId: membership.id,
            workItemId: itemId,
          }),
          { ttl: ITEM_TTL },
        );
        items.set(itemId, cleanup);
      }
      while (items.size > RECENT_ITEMS) {
        const [oldest, cleanup] = items.entries().next().value!;
        cleanup();
        items.delete(oldest);
      }
    },
    [zero, membership.id],
  );
  useEffect(() => {
    const items = recent.current;
    return () => {
      for (const cleanup of items.values()) cleanup();
      items.clear();
    };
  }, []);

  const delivery = useMemo(() => deliveryIndex(directory), [directory]);
  // Directory-derived helpers keep their identity while only entities change,
  // so memoized rows receiving them do not re-render on every change.
  const roles = useMemo(() => {
    const admin = applicationRoleOf(membership.role) === "admin";
    const memberNames = new Map(directory.members.map((m) => [m.id, m.name]));
    // History by people who left stays attributed by name.
    for (const m of directory.formerMembers)
      memberNames.set(m.id, formerMemberName(m.name));
    const disciplineNames = new Map(
      directory.disciplines.map((d) => [d.id, d.name]),
    );
    return {
      disciplineIds: myDisciplineIds(directory, userId),
      capabilitiesIn: (projectId: string | null | undefined) =>
        projectId
          ? capabilitiesOf(directory.disciplines, userId, projectId)
          : noCapabilities,
      canManage: (projectId: string | null | undefined) =>
        !!projectId && canManageProject(directory, userId, admin, projectId),
      isAdmin: admin,
      memberName: (id: string | null | undefined) =>
        id === "system"
          ? "Lictory"
          : id === AI_ACTOR_ID
            ? AI_ACTOR_NAME
            : id
              ? (memberNames.get(id) ?? "Former member")
              : "Unassigned",
      disciplineName: (id: string | null | undefined) =>
        (id ? disciplineNames.get(id) : undefined) ?? "Discipline",
    };
  }, [directory, userId, membership.role]);
  const lists = useMemo(() => {
    const all = Object.values(entities);
    const projects = byType(all, "project")
      .filter((p) => !p.archivedAt)
      .sort((a, b) => a.name.localeCompare(b.name));
    return {
      projects: projects.length ? projects : directory.projects,
      items: byType(all, "workItem"),
      labels: byType(all, "label").sort((a, b) => a.name.localeCompare(b.name)),
      milestones: byType(all, "milestone").sort(
        (a, b) =>
          (a.targetDate ?? "9").localeCompare(b.targetDate ?? "9") ||
          a.name.localeCompare(b.name),
      ),
      relations: byType(all, "relation"),
    };
  }, [entities, directory.projects]);
  const status = viewStatus(connection, complete);
  const view = useMemo<View>(
    () => ({
      entities,
      directory,
      pending: organizationPending,
      status,
      error: queryError,
      cursor,
    }),
    [entities, directory, organizationPending, status, queryError, cursor],
  );
  const value = useMemo<WorkspaceContextValue>(() => {
    // Name and branding follow the synchronized profile, so a change made
    // elsewhere appears without a reload.
    return {
      userId,
      organization: profile
        ? {
            ...membership,
            name: profile.name,
            slug: profile.slug,
            logos: { icon: null, ...profile.logos },
            brandColor: profile.brandColor ?? null,
          }
        : membership,
      view,
      directory,
      ...lists,
      delivery,
      ...roles,
      mutate,
      mutateConfirmed,
      applyConfirmed,
      connection,
      connectionReason,
      everConnected,
      reconnect: reconnectWorkspace,
      recovery,
      touchItem,
    };
  }, [
    view,
    directory,
    lists,
    roles,
    delivery,
    userId,
    membership,
    profile,
    mutate,
    mutateConfirmed,
    applyConfirmed,
    connection,
    connectionReason,
    everConnected,
    recovery,
    touchItem,
  ]);
  return (
    <WorkspaceContext.Provider value={value}>
      <DeliveryContext.Provider value={delivery}>
        <AvatarImages members={directory.members}>{children}</AvatarImages>
      </DeliveryContext.Provider>
    </WorkspaceContext.Provider>
  );
}

export function useWorkspace() {
  const value = useContext(WorkspaceContext);
  if (!value) throw new Error("useWorkspace requires WorkspaceProvider.");
  return value;
}

// The workspace when one is open (surfaces shared with other pages, such as
// rendered Markdown, read it only when it exists).
export function useOptionalWorkspace() {
  return useContext(WorkspaceContext);
}

// Whether writes can reach the server right now.
export function useCanWrite() {
  return canWrite(useWorkspace().connection);
}

// Full history for one item, on top of the organization's lists. The item's
// rows load when it is opened; until then the organization data keeps the page
// populated.
export function useItemView(itemId: string, enabled = true) {
  const workspace = useWorkspace();
  const {
    organization,
    view: orgView,
    mutate: mutateWorkspace,
    touchItem,
  } = workspace;
  const [rows, result] = useQuery(
    queries.workItem({ organizationId: organization.id, workItemId: itemId }),
    { enabled, ttl: ITEM_TTL },
  );
  useEffect(() => {
    if (enabled) touchItem(itemId);
  }, [enabled, itemId, touchItem]);
  const itemEntities = useStableEntities(rows ?? emptyRows);
  const merged = useMemo<Entities>(
    () => ({ ...orgView.entities, ...itemEntities }),
    [orgView.entities, itemEntities],
  );
  const loaded = enabled && result.type === "complete";
  const view = useMemo<View>(
    () => ({
      ...orgView,
      entities: merged,
      status: loaded ? orgView.status : enabled ? "hydrating" : orgView.status,
    }),
    [orgView, merged, loaded, enabled],
  );
  const entities = useMemo<Entity[]>(() => Object.values(merged), [merged]);
  const mutate = useCallback(
    (command: Command) => mutateWorkspace(command, merged),
    [mutateWorkspace, merged],
  );
  return { view, entities, mutate, loaded };
}
