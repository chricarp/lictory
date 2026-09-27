// The boundary between Lictory's delivery domain and external delivery
// systems. The domain speaks in work items, revisions and labels; each adapter
// translates to its system (Jira issue types, ADF, JQL) and back. Nothing
// outside src/delivery/<provider> may know provider-specific shapes.
//
// Ownership: title, content and labels are owned by Lictory and pushed
// one-way on explicit export. Everything else (status, assignee, sprint,
// comments) is owned externally; status is only read back for display.

export type DeliveryProviderKind = "jira_cloud";

export type DeliveryConnection = {
  baseUrl: string;
  credential: unknown;
};

export type DeliveryTarget = {
  projectId: string;
  projectKey: string;
};

export type ExternalRef = { id: string; key: string; url: string };

export type ExternalItem = ExternalRef & {
  title: string;
  status: string;
  typeId: string;
  parentId: string | null;
  labels: string[];
  updatedAt: Date;
  // Lictory work item id stamped on the item when Lictory created or adopted it.
  lictoryItemId: string | null;
};

export type ExternalItemType = {
  id: string;
  name: string;
  // Provider-neutral hierarchy: 1 = epic-like, 0 = standard, -1 = subtask.
  hierarchyLevel: number;
  // Fields the external system requires on create that Lictory cannot fill.
  unsupportedRequiredFields: { id: string; name: string }[];
};

export type ExternalProject = {
  id: string;
  key: string;
  name: string;
  types: ExternalItemType[];
};

// What Lictory pushes for one work item. Built by the domain from the latest
// revision; adapters must not reach back into the database.
export type DeliveryPayload = {
  lictoryItemId: string;
  lictoryKey: string;
  lictoryUrl: string;
  revisionNumber: number;
  title: string;
  // Markdown specification, including the acceptance criteria section.
  content: string;
  labels: string[];
  externalTypeId: string;
  parent: ExternalRef | null;
};

export type OwnedField = "title" | "content" | "labels";

export type DeliveryErrorKind =
  | "authentication"
  | "permission"
  | "not_found"
  | "validation"
  | "rate_limited"
  | "unavailable";

// Errors carry an actionable message for the user plus whether a retry can
// succeed without anyone changing configuration.
export class DeliveryError extends Error {
  constructor(
    readonly kind: DeliveryErrorKind,
    message: string,
    readonly fieldErrors: Record<string, string> = {},
    readonly retryAfterMs?: number,
  ) {
    super(message);
    this.name = "DeliveryError";
  }

  get retryable() {
    return this.kind === "rate_limited" || this.kind === "unavailable";
  }
}

export interface DeliveryProvider {
  readonly kind: DeliveryProviderKind;
  // Canonical form of the installation URL; it identifies the namespace.
  normalizeBaseUrl(url: string): string;
  // Confirms the credential works; returns who it acts as.
  verify(connection: DeliveryConnection): Promise<{ accountLabel: string }>;
  listProjects(
    connection: DeliveryConnection,
    query?: string,
  ): Promise<Omit<ExternalProject, "types">[]>;
  describeProject(
    connection: DeliveryConnection,
    projectIdOrKey: string,
  ): Promise<ExternalProject>;
  // By id or human key; null when it does not exist or is not visible.
  getItem(
    connection: DeliveryConnection,
    idOrKey: string,
  ): Promise<ExternalItem | null>;
  // Recovers an item Lictory created but never recorded (crash between the
  // external create and the local commit). Must only return items stamped
  // with this Lictory item id.
  findCreated(
    connection: DeliveryConnection,
    target: DeliveryTarget,
    hint: { lictoryItemId: string; title: string; since: Date },
  ): Promise<ExternalItem | null>;
  createItem(
    connection: DeliveryConnection,
    target: DeliveryTarget,
    payload: DeliveryPayload,
  ): Promise<ExternalItem>;
  // Overwrites Lictory-owned fields only. Labels Lictory did not push are kept.
  updateItem(
    connection: DeliveryConnection,
    ref: ExternalRef,
    payload: DeliveryPayload,
  ): Promise<ExternalItem>;
  // Lictory-owned fields someone changed externally after `since`.
  changedSince(
    connection: DeliveryConnection,
    ref: ExternalRef,
    since: Date,
  ): Promise<OwnedField[]>;
  // Idempotent back-reference from the external item to Lictory.
  linkBack(
    connection: DeliveryConnection,
    ref: ExternalRef,
    payload: DeliveryPayload,
  ): Promise<void>;
}
