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
import { AvatarImages } from "~/components/ui/avatar";
import { toast, Toaster } from "~/components/ui/toast";
import {
  analyticsConfigured,
  clearAnalyticsOrganization,
  identifyUser,
  setAnalyticsOrganization,
  track,
} from "~/lib/analytics/client";
import { statusChangeBlocker } from "~/sync/client/preflight";
import { SyncEngine, type Rejection, type View } from "~/sync/client/engine";
import {
  applicationRoleOf,
  canManageProject,
  capabilitiesOf,
  type Capabilities,
  type Command,
  type Directory,
  type Entity,
  noCapabilities,
  type WorkItem,
} from "~/sync/shared/protocol";
import { AI_ACTOR_ID, AI_ACTOR_NAME } from "~/sync/shared/ai";
import {
  byType,
  deliveryIndex,
  myDisciplineIds,
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
  // Active disciplines I hold in any project (for "needs my review").
  disciplineIds: string[];
  // Work item capabilities come from my disciplines in one project.
  capabilitiesIn: (projectId: string | null | undefined) => Capabilities;
  // Project configuration: organization administrators and project admins.
  canManage: (projectId: string | null | undefined) => boolean;
  // Application role: administrators manage the organization and every project.
  isAdmin: boolean;
  mutate: (
    command: Command,
    target?: SyncEngine,
  ) => Promise<string | undefined>;
  memberName: (id: string | null | undefined) => string;
  disciplineName: (id: string | null | undefined) => string;
  acquireItem: (itemId: string, projectId: string) => SyncEngine;
  peekItem: (itemId: string) => SyncEngine | undefined;
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

// Keeps recently opened item engines in memory so moving between Stories only
// selects data that already exists locally. Engines nobody displays are
// suspended: they stop following realtime signals and catch up when shown
// again. Each engine has its own IndexedDB cache, so a revisit after eviction
// is still instant from disk.
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
    setAnalyticsOrganization(organization.id);
    if (lastOrganization.current !== organization.id) {
      track("workspace_opened", {
        organization_id: organization.id,
        application_role: organization.role,
      });
      lastOrganization.current = organization.id;
    }
    return () => clearAnalyticsOrganization();
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
      entry.engine.resume();
      // Evicting after acquisition, not on release, guarantees the item being
      // opened is never the one dropped.
      const idle = [...cache.entries()]
        .filter(([, e]) => e.refs === 0)
        .sort((a, b) => a[1].used - b[1].used);
      while (cache.size > ITEM_ENGINE_LIMIT && idle.length) {
        const [id, victim] = idle.shift()!;
        victim.unsubscribe();
        victim.engine.stop();
        cache.delete(id);
      }
      return entry.engine;
    },
    [organization.id, userId, notifyRejection],
  );
  // Render-time read of a cached engine, so a revisited item paints from its
  // local history on the first frame instead of after an effect.
  const peekItem = useCallback(
    (itemId: string) => itemEngines.current.get(itemId)?.engine,
    [],
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
    if (entry.refs === 0) entry.engine.suspend();
  }, []);
  const directory = view.directory.organizations.length
    ? view.directory
    : initialDirectory;
  const delivery = useMemo(() => deliveryIndex(directory), [directory]);
  // Directory-derived helpers keep their identity while only entities change,
  // so memoized rows receiving them do not re-render on every sync.
  const roles = useMemo(() => {
    const admin = applicationRoleOf(organization.role) === "admin";
    const memberNames = new Map(directory.members.map((m) => [m.id, m.name]));
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
  }, [directory, userId, organization.role]);
  const lists = useMemo(() => {
    const entities = Object.values(view.entities);
    const projects = byType(entities, "project")
      .filter((p) => !p.archivedAt)
      .sort((a, b) => a.name.localeCompare(b.name));
    return {
      projects: projects.length ? projects : directory.projects,
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
    };
  }, [view.entities, directory.projects]);
  const value = useMemo<WorkspaceContextValue>(() => {
    // Name and branding follow the live directory, so a change made elsewhere
    // appears without a reload. Access still comes from the server render.
    const live = directory.organizations.find((o) => o.id === organization.id);
    return {
      userId,
      organization: live
        ? {
            ...organization,
            name: live.name,
            slug: live.slug,
            logos: live.logos,
          }
        : organization,
      engine,
      view,
      directory,
      ...lists,
      delivery,
      ...roles,
      mutate,
      acquireItem,
      peekItem,
      releaseItem,
      refreshWorkspace,
    };
  }, [
    view,
    directory,
    lists,
    roles,
    delivery,
    userId,
    organization,
    engine,
    acquireItem,
    peekItem,
    releaseItem,
    refreshWorkspace,
    mutate,
  ]);
  return (
    <WorkspaceContext.Provider value={value}>
      <DeliveryContext.Provider value={delivery}>
        <AvatarImages members={directory.members}>{children}</AvatarImages>
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
  const {
    acquireItem,
    peekItem,
    releaseItem,
    mutate: mutateWorkspace,
  } = useWorkspace();
  const [acquired, setAcquired] = useState<{
    itemId: string;
    engine: SyncEngine;
  }>();
  useEffect(() => {
    if (!enabled) return;
    const e = acquireItem(itemId, projectId);
    // Synchronizes with an external engine cache; the engine only exists
    // after acquisition, so it cannot be derived during render.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setAcquired({ itemId, engine: e });
    return () => {
      setAcquired(undefined);
      releaseItem(itemId);
    };
  }, [itemId, projectId, enabled, acquireItem, releaseItem]);
  // A revisit finds its engine already cached: render from it immediately and
  // let the acquisition above resume it in the background, rather than paint
  // one frame of fallback data and then swap everything.
  const engine = !enabled
    ? undefined
    : acquired?.itemId === itemId
      ? acquired.engine
      : peekItem(itemId);
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
    projectMembers: [],
    disciplines: [],
    teams: [],
    types: [],
    projectTypes: [],
    statuses: [],
    iterations: [],
    delivery: { connections: [], targets: [] },
    readiness: [],
    ai: { enabled: false, available: false },
  },
  pending: [],
  status: "hydrating",
};
