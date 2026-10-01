"use client";
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
import posthog from "posthog-js";
import { toast, Toaster } from "~/components/ui/toast";
import {
  analyticsConfigured,
  identifyUser,
  track,
} from "~/lib/analytics/client";
import { statusChangeBlocker } from "~/sync/client/preflight";
import { SyncEngine, type Rejection, type View } from "~/sync/client/engine";
import {
  applicationRoleOf,
  capabilitiesOf,
  type Capabilities,
  type Command,
  type Directory,
  type Entity,
  type WorkItem,
} from "~/sync/shared/protocol";
import {
  byType,
  deliveryIndex,
  myRoleIds,
  type Delivery,
  type Label,
  type Milestone,
  type Project,
  type Relation,
} from "~/lib/work-items";

type Organization = Directory["organizations"][number];

type WorkspaceContextValue = {
  userId: string;
  organization: Organization;
  engine: SyncEngine;
  view: View;
  directory: Directory;
  projects: Project[];
  items: WorkItem[];
  labels: Label[];
  milestones: Milestone[];
  relations: Relation[];
  // Teams, types, statuses and iterations indexed from the directory.
  delivery: Delivery;
  // Active organization roles I hold, and the union of their capabilities.
  roleIds: string[];
  capabilities: Capabilities;
  // Application role: administrators manage the organization, projects and roles.
  isAdmin: boolean;
  mutate: (
    command: Command,
    target?: SyncEngine,
  ) => Promise<string | undefined>;
  memberName: (id: string | null | undefined) => string;
  roleName: (id: string | null | undefined) => string;
  acquireItem: (itemId: string, projectId: string) => SyncEngine;
  releaseItem: (itemId: string) => void;
  refreshWorkspace: () => Promise<void>;
};
const WorkspaceContext = createContext<WorkspaceContextValue | null>(null);
// Delivery configuration changes far less often than entities; a separate
// context keeps memoized rows from re-rendering on every sync.
const DeliveryContext = createContext<Delivery | null>(null);
export function useDelivery() {
  const value = useContext(DeliveryContext);
  if (!value) throw new Error("useDelivery requires WorkspaceProvider.");
  return value;
}

// Keeps recently opened item engines alive so moving between Stories only
// selects data that already exists locally. Each engine has its own IndexedDB
// cache, so a revisit after eviction is still instant from disk.
const ITEM_ENGINE_LIMIT = 8;

export function WorkspaceProvider({
  userId,
  organization,
  initialDirectory,
  children,
}: {
  userId: string;
  organization: Organization;
  initialDirectory: Directory;
  children: ReactNode;
}) {
  const lastOrganization = useRef<string | null>(null);
  useEffect(() => {
    if (!analyticsConfigured) return;
    identifyUser(userId);
    try {
      posthog.group("organization", organization.id);
      posthog.register({ organization_id: organization.id });
    } catch {
      // Analytics must not prevent opening a workspace.
    }
    if (lastOrganization.current !== organization.id) {
      track("workspace_opened", {
        organization_id: organization.id,
        application_role: organization.role,
      });
      lastOrganization.current = organization.id;
    }
    return () => {
      try {
        posthog.unregister("organization_id");
        posthog.resetGroups();
      } catch {
        // Workspace navigation must not depend on analytics.
      }
    };
  }, [organization.id, organization.role, userId]);
  const [engine] = useState(
    () => new SyncEngine(userId, { organizationId: organization.id }),
  );
  const view = useSyncExternalStore(
    engine.subscribe,
    engine.getSnapshot,
    engine.getSnapshot,
  );
  useEffect(() => {
    void engine.start();
    return () => engine.stop();
  }, [engine]);
  const notifiedRejections = useRef(new Set<string>());
  const notifyRejection = useCallback((rejection: Rejection) => {
    if (notifiedRejections.current.has(rejection.mutationId)) return;
    notifiedRejections.current.add(rejection.mutationId);
    toast.add({
      title: "Change not applied",
      type: "error",
      id: rejection.mutationId,
      description: rejection.message,
      timeout: 8000,
    });
  }, []);
  useEffect(
    () => engine.subscribeRejections(notifyRejection),
    [engine, notifyRejection],
  );
  const mutate = useCallback(
    async (command: Command, target = engine) => {
      const organizationView = engine.getSnapshot();
      const targetView = target.getSnapshot();
      const directory = organizationView.directory.organizations.length
        ? organizationView.directory
        : targetView.directory.organizations.length
          ? targetView.directory
          : initialDirectory;
      const blocker =
        command.type === "updateWorkItem" && command.statusId
          ? statusChangeBlocker(
              command,
              targetView.entities[`workItem:${command.workItemId}`]
                ? targetView.entities
                : organizationView.entities,
              directory,
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
      return target.mutate(command);
    },
    [engine, initialDirectory],
  );
  const itemEngines = useRef(
    new Map<
      string,
      {
        engine: SyncEngine;
        refs: number;
        used: number;
        unsubscribe: () => void;
      }
    >(),
  );
  useEffect(() => {
    const cache = itemEngines.current;
    return () => {
      for (const entry of cache.values()) {
        entry.unsubscribe();
        entry.engine.stop();
      }
      cache.clear();
    };
  }, []);
  const acquireItem = useCallback(
    (itemId: string, projectId: string) => {
      const cache = itemEngines.current;
      let entry = cache.get(itemId);
      if (!entry) {
        const itemEngine = new SyncEngine(userId, {
          organizationId: organization.id,
          projectId,
          workItemId: itemId,
        });
        entry = {
          engine: itemEngine,
          unsubscribe: itemEngine.subscribeRejections(notifyRejection),
          refs: 0,
          used: Date.now(),
        };
        cache.set(itemId, entry);
        void entry.engine.start();
      }
      entry.refs++;
      entry.used = Date.now();
      return entry.engine;
    },
    [organization.id, userId, notifyRejection],
  );
  const refreshWorkspace = useCallback(async () => {
    await engine.reset();
    for (const entry of itemEngines.current.values())
      await entry.engine.reset();
  }, [engine]);
  const releaseItem = useCallback((itemId: string) => {
    const cache = itemEngines.current;
    const entry = cache.get(itemId);
    if (!entry) return;
    entry.refs = Math.max(0, entry.refs - 1);
    const idle = [...cache.entries()]
      .filter(([, e]) => e.refs === 0)
      .sort((a, b) => a[1].used - b[1].used);
    while (cache.size > ITEM_ENGINE_LIMIT && idle.length) {
      const [id, victim] = idle.shift()!;
      victim.unsubscribe();
      victim.engine.stop();
      cache.delete(id);
    }
  }, []);
  const directory = view.directory.organizations.length
    ? view.directory
    : initialDirectory;
  const delivery = useMemo(() => deliveryIndex(directory), [directory]);
  const value = useMemo<WorkspaceContextValue>(() => {
    const entities = Object.values(view.entities);
    const projects = byType(entities, "project")
      .filter((p) => !p.archivedAt)
      .sort((a, b) => a.name.localeCompare(b.name));
    const merged = projects.length ? projects : directory.projects;
    return {
      userId,
      organization,
      engine,
      view,
      directory,
      projects: merged,
      items: byType(entities, "workItem"),
      labels: byType(entities, "label").sort((a, b) =>
        a.name.localeCompare(b.name),
      ),
      milestones: byType(entities, "milestone").sort(
        (a, b) =>
          (a.targetDate ?? "9").localeCompare(b.targetDate ?? "9") ||
          a.name.localeCompare(b.name),
      ),
      relations: byType(entities, "relation"),
      delivery,
      roleIds: myRoleIds(directory, userId),
      capabilities: capabilitiesOf(directory.roles, userId),
      isAdmin: applicationRoleOf(organization.role) === "admin",
      mutate,
      memberName: (id) =>
        id === "system"
          ? "Lictory"
          : id
            ? (directory.members.find((m) => m.id === id)?.name ??
              "Former member")
            : "Unassigned",
      roleName: (id) =>
        directory.roles.find((r) => r.id === id)?.name ?? "Role",
      acquireItem,
      releaseItem,
      refreshWorkspace,
    };
  }, [
    view,
    directory,
    delivery,
    userId,
    organization,
    engine,
    acquireItem,
    releaseItem,
    refreshWorkspace,
    mutate,
  ]);
  return (
    <WorkspaceContext.Provider value={value}>
      <DeliveryContext.Provider value={delivery}>
        {children}
        <Toaster />
      </DeliveryContext.Provider>
    </WorkspaceContext.Provider>
  );
}

export function useWorkspace() {
  const value = useContext(WorkspaceContext);
  if (!value) throw new Error("useWorkspace requires WorkspaceProvider.");
  return value;
}

// Full history for one item. Entities from the item engine are authoritative for
// the item; the organization engine still provides the summary for lists.
export function useItemEngine(
  itemId: string,
  projectId: string,
  enabled = true,
) {
  const { acquireItem, releaseItem, mutate: mutateWorkspace } = useWorkspace();
  const [engine, setEngine] = useState<SyncEngine>();
  useEffect(() => {
    if (!enabled) return;
    const e = acquireItem(itemId, projectId);
    // Synchronizes with an external engine cache; the engine only exists
    // after acquisition, so it cannot be derived during render.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setEngine(e);
    return () => {
      setEngine(undefined);
      releaseItem(itemId);
    };
  }, [itemId, projectId, enabled, acquireItem, releaseItem]);
  const subscribe = useCallback(
    (listener: () => void) =>
      engine
        ? engine.subscribe(listener)
        : () => {
            /* no engine yet */
          },
    [engine],
  );
  const snapshot = useCallback(
    () => (engine ? engine.getSnapshot() : hydratingView),
    [engine],
  );
  const view = useSyncExternalStore(subscribe, snapshot, snapshot);
  const mutate = useCallback(
    (command: Command) => {
      if (!engine) return Promise.reject(new Error("Opening item…"));
      return mutateWorkspace(command, engine);
    },
    [engine, mutateWorkspace],
  );
  const entities = useMemo<Entity[]>(
    () => Object.values(view.entities),
    [view.entities],
  );
  return { view, entities, mutate, engine };
}
const hydratingView: View = {
  entities: {},
  directory: {
    organizations: [],
    projects: [],
    members: [],
    roles: [],
    teams: [],
    types: [],
    iterations: [],
    delivery: { connections: [], targets: [] },
  },
  pending: [],
  status: "hydrating",
};
