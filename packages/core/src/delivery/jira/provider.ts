import {
  markdownToAdf,
  type AdfDocument,
} from "@lictory/core/delivery/jira/adf";
import {
  createJiraClient,
  jiraCredential,
  type JiraClientOptions,
  type JiraRequestOptions,
} from "@lictory/core/delivery/jira/client";
import {
  DeliveryError,
  type DeliveryConnection,
  type DeliveryPayload,
  type DeliveryProvider,
  type ExternalItem,
  type ExternalItemType,
  type ExternalRef,
  type ExternalStatusCategory,
  type OwnedField,
} from "@lictory/core/delivery/provider";

// Jira Cloud adapter (REST v3, API token). Identity of exported issues is
// stamped in the `lictory.item` issue property (invisible to users) so a
// crashed export can be recovered without creating duplicates. The same
// property records which labels Lictory pushed, so labels added in Jira are
// never removed.

export const JIRA_PROPERTY = "lictory.item";
const SUMMARY_MAX = 255;
const ISSUE_FIELDS = "summary,status,assignee,issuetype,parent,labels,updated";
// Jira's fixed status categories, by key.
const STATUS_CATEGORIES: Record<string, ExternalStatusCategory> = {
  new: "todo",
  indeterminate: "in_progress",
  done: "done",
};
// Fields Lictory fills on create; any other required field without a
// default blocks export of that type until the Jira admin adds one.
const FILLED_FIELDS = new Set([
  "project",
  "issuetype",
  "summary",
  "description",
  "labels",
  "parent",
  "reporter",
]);

type LictoryProperty = { itemId: string; key: string; labels: string[] };

type JiraIssue = {
  id: string;
  key: string;
  fields: {
    summary: string;
    status?: { name: string; statusCategory?: { key: string } };
    assignee?: { displayName?: string } | null;
    issuetype: { id: string };
    parent?: { id: string };
    labels?: string[];
    updated: string;
  };
  properties?: Record<string, unknown>;
};

export function createJiraCloudProvider(
  options: JiraClientOptions = {},
): DeliveryProvider {
  const request = createJiraClient(options);
  const call = <T>(
    connection: DeliveryConnection,
    method: "GET" | "POST" | "PUT" | "DELETE",
    path: string,
    body?: unknown,
    options?: JiraRequestOptions,
  ) =>
    request<T>(
      connection.baseUrl,
      jiraCredential(connection.credential),
      method,
      path,
      body,
      options,
    );

  const toItem = (connection: DeliveryConnection, issue: JiraIssue) => {
    const property = readProperty(issue.properties?.[JIRA_PROPERTY]);
    return {
      id: issue.id,
      key: issue.key,
      url: `${connection.baseUrl}/browse/${issue.key}`,
      title: issue.fields.summary,
      status: issue.fields.status?.name ?? "",
      statusCategory:
        STATUS_CATEGORIES[issue.fields.status?.statusCategory?.key ?? ""] ??
        null,
      assignee: issue.fields.assignee?.displayName ?? null,
      typeId: issue.fields.issuetype.id,
      parentId: issue.fields.parent?.id ?? null,
      labels: issue.fields.labels ?? [],
      updatedAt: new Date(issue.fields.updated),
      lictoryItemId: property?.itemId ?? null,
    } satisfies ExternalItem;
  };

  const getIssue = async (connection: DeliveryConnection, idOrKey: string) => {
    try {
      return await call<JiraIssue>(
        connection,
        "GET",
        `/rest/api/3/issue/${encodeURIComponent(idOrKey)}?fields=${ISSUE_FIELDS}&properties=${JIRA_PROPERTY}`,
      );
    } catch (error) {
      if (error instanceof DeliveryError && error.kind === "not_found")
        return null;
      throw error;
    }
  };

  const mustGet = async (connection: DeliveryConnection, id: string) => {
    const issue = await getIssue(connection, id);
    if (!issue)
      throw new DeliveryError(
        "not_found",
        `Jira issue ${id} disappeared right after it was written.`,
      );
    return toItem(connection, issue);
  };

  return {
    kind: "jira_cloud",

    normalizeBaseUrl(url) {
      let parsed: URL;
      try {
        parsed = new URL(
          url.trim().includes("://") ? url.trim() : `https://${url.trim()}`,
        );
      } catch {
        throw new DeliveryError(
          "validation",
          "Enter your Jira site URL, for example https://acme.atlassian.net.",
        );
      }
      if (parsed.protocol !== "https:" && !localDevelopment(parsed))
        throw new DeliveryError(
          "validation",
          "Jira Cloud sites must use https.",
        );
      return parsed.origin;
    },

    async verify(connection) {
      const me = await call<{
        accountId: string;
        displayName?: string;
        emailAddress?: string;
      }>(connection, "GET", "/rest/api/3/myself");
      if (!me?.accountId)
        throw new DeliveryError(
          "authentication",
          "Jira did not identify the account for this API token.",
        );
      const email = jiraCredential(connection.credential).email;
      return {
        accountLabel: me.displayName ? `${me.displayName} (${email})` : email,
      };
    },

    async listProjects(connection, query) {
      const params = new URLSearchParams({ maxResults: "50", orderBy: "name" });
      if (query) params.set("query", query);
      const page = await call<{
        values: { id: string; key: string; name: string }[];
      }>(connection, "GET", `/rest/api/3/project/search?${params}`);
      return (page?.values ?? []).map(({ id, key, name }) => ({
        id,
        key,
        name,
      }));
    },

    async describeProject(connection, projectIdOrKey) {
      const project = await call<{
        id: string;
        key: string;
        name: string;
        issueTypes: {
          id: string;
          name: string;
          subtask: boolean;
          hierarchyLevel?: number;
        }[];
      }>(
        connection,
        "GET",
        `/rest/api/3/project/${encodeURIComponent(projectIdOrKey)}`,
      );
      if (!project)
        throw new DeliveryError(
          "not_found",
          `Jira project ${projectIdOrKey} was not found.`,
        );
      const types = await Promise.all(
        project.issueTypes.map(async (type): Promise<ExternalItemType> => {
          const meta = await call<{
            fields?: CreateField[];
            values?: CreateField[];
          }>(
            connection,
            "GET",
            `/rest/api/3/issue/createmeta/${project.id}/issuetypes/${type.id}?maxResults=200`,
          );
          const fields = meta?.fields ?? meta?.values ?? [];
          return {
            id: type.id,
            name: type.name,
            hierarchyLevel: type.hierarchyLevel ?? (type.subtask ? -1 : 0),
            unsupportedRequiredFields: fields
              .filter(
                (f) =>
                  f.required &&
                  !f.hasDefaultValue &&
                  !FILLED_FIELDS.has(f.fieldId),
              )
              .map((f) => ({ id: f.fieldId, name: f.name })),
          };
        }),
      );
      return { id: project.id, key: project.key, name: project.name, types };
    },

    async getItem(connection, idOrKey) {
      const issue = await getIssue(connection, idOrKey);
      return issue ? toItem(connection, issue) : null;
    },

    async getItems(connection, ids) {
      const found: ExternalItem[] = [];
      // JQL accepts numeric ids; batches stay well under Jira's page size.
      const numeric = ids.filter((id) => /^\d+$/.test(id));
      for (let i = 0; i < numeric.length; i += 50) {
        const batch = numeric.slice(i, i + 50);
        const result = await call<{ issues: JiraIssue[] }>(
          connection,
          "POST",
          "/rest/api/3/search/jql",
          {
            jql: `id in (${batch.join(",")})`,
            fields: ISSUE_FIELDS.split(","),
            properties: [JIRA_PROPERTY],
            maxResults: batch.length,
          },
        );
        for (const issue of result?.issues ?? [])
          found.push(toItem(connection, issue));
      }
      return found;
    },

    async findCreated(connection, target, hint) {
      // Entity properties are only JQL-searchable for apps, so narrow by
      // project, creator and time, then confirm via the property itself.
      const minutes = Math.max(
        5,
        Math.ceil((Date.now() - hint.since.getTime()) / 60_000) + 5,
      );
      const result = await call<{ issues: JiraIssue[] }>(
        connection,
        "POST",
        "/rest/api/3/search/jql",
        {
          jql: `project = ${target.projectId} AND reporter = currentUser() AND created >= -${minutes}m ORDER BY created DESC`,
          fields: ISSUE_FIELDS.split(","),
          properties: [JIRA_PROPERTY],
          maxResults: 50,
        },
      );
      const match = result?.issues.find(
        (issue) =>
          readProperty(issue.properties?.[JIRA_PROPERTY])?.itemId ===
          hint.lictoryItemId,
      );
      return match ? toItem(connection, match) : null;
    },

    async createItem(connection, target, payload) {
      const created = await call<{ id: string; key: string }>(
        connection,
        "POST",
        "/rest/api/3/issue",
        {
          fields: {
            project: { id: target.projectId },
            issuetype: { id: payload.externalTypeId },
            summary: summary(payload.title),
            description: description(payload),
            labels: labels(payload.labels),
            ...(payload.parent ? { parent: { id: payload.parent.id } } : {}),
          },
          properties: [{ key: JIRA_PROPERTY, value: property(payload) }],
        },
        { once: true },
      );
      if (!created?.id)
        throw new DeliveryError(
          "unavailable",
          "Jira did not return the created issue.",
        );
      return mustGet(connection, created.id);
    },

    async updateItem(connection, ref, payload) {
      const current = await getIssue(connection, ref.id);
      if (!current)
        throw new DeliveryError(
          "not_found",
          `Jira issue ${ref.key} no longer exists. Unlink it to export a new one.`,
        );
      const previous = readProperty(current.properties?.[JIRA_PROPERTY]);
      if (previous && previous.itemId !== payload.lictoryItemId)
        throw new DeliveryError(
          "validation",
          `Jira issue ${ref.key} is linked to another Lictory item.`,
        );
      const next = labels(payload.labels);
      const existing = new Set(current.fields.labels ?? []);
      const labelOps = [
        ...next.filter((l) => !existing.has(l)).map((l) => ({ add: l })),
        ...(previous?.labels ?? [])
          .filter((l) => !next.includes(l) && existing.has(l))
          .map((l) => ({ remove: l })),
      ];
      await call(connection, "PUT", `/rest/api/3/issue/${ref.id}`, {
        fields: {
          summary: summary(payload.title),
          description: description(payload),
          ...(payload.parent && current.fields.parent?.id !== payload.parent.id
            ? { parent: { id: payload.parent.id } }
            : {}),
        },
        ...(labelOps.length ? { update: { labels: labelOps } } : {}),
      });
      await call(
        connection,
        "PUT",
        `/rest/api/3/issue/${ref.id}/properties/${JIRA_PROPERTY}`,
        property(payload),
      );
      return mustGet(connection, ref.id);
    },

    async changedSince(connection, ref, since) {
      const managed = new Set(
        readProperty(
          (await getIssue(connection, ref.id))?.properties?.[JIRA_PROPERTY],
        )?.labels ?? [],
      );
      const changed = new Set<OwnedField>();
      for (let startAt = 0; ;) {
        const page = await call<{
          values: {
            created: string;
            items: {
              fieldId?: string;
              field: string;
              fromString?: string | null;
              toString?: string | null;
            }[];
          }[];
          isLast: boolean;
          maxResults: number;
        }>(
          connection,
          "GET",
          `/rest/api/3/issue/${ref.id}/changelog?startAt=${startAt}&maxResults=100`,
        );
        const values = page?.values ?? [];
        for (const entry of values) {
          if (new Date(entry.created) <= since) continue;
          for (const item of entry.items) {
            const field = item.fieldId ?? item.field;
            if (field === "summary") changed.add("title");
            else if (field === "description") changed.add("content");
            else if (field === "labels") {
              // Adding Jira-only labels is not a conflict; removing one
              // Lictory pushed is.
              const after = new Set(split(item.toString));
              if (
                split(item.fromString).some(
                  (l) => managed.has(l) && !after.has(l),
                )
              )
                changed.add("labels");
            }
          }
        }
        if (!page || page.isLast || values.length === 0) break;
        startAt += values.length;
      }
      return [...changed];
    },

    async linkBack(connection, ref: ExternalRef, payload) {
      await call(connection, "POST", `/rest/api/3/issue/${ref.id}/remotelink`, {
        globalId: `lictory:item:${payload.lictoryItemId}`,
        application: { type: "com.lictory", name: "Lictory" },
        relationship: "specified in",
        object: {
          url: payload.lictoryUrl,
          title: payload.lictoryKey,
          summary: payload.title,
        },
      });
    },
  };
}

type CreateField = {
  fieldId: string;
  name: string;
  required: boolean;
  hasDefaultValue?: boolean;
};

function summary(title: string) {
  const single = title.replace(/\s+/g, " ").trim();
  return single.length > SUMMARY_MAX
    ? `${single.slice(0, SUMMARY_MAX - 1)}…`
    : single;
}

// Jira labels cannot contain spaces.
export function labels(names: string[]) {
  return [
    ...new Set(names.map((n) => n.trim().replace(/\s+/g, "-")).filter(Boolean)),
  ];
}

function description(payload: DeliveryPayload): AdfDocument {
  const doc = markdownToAdf(payload.content);
  doc.content.push(
    { type: "rule" },
    {
      type: "paragraph",
      content: [
        { type: "text", text: "Exported from Lictory " },
        {
          type: "text",
          text: payload.lictoryKey,
          marks: [{ type: "link", attrs: { href: payload.lictoryUrl } }],
        },
        { type: "text", text: ` · revision ${payload.revisionNumber}` },
      ],
    },
  );
  return doc;
}

function property(payload: DeliveryPayload): LictoryProperty {
  return {
    itemId: payload.lictoryItemId,
    key: payload.lictoryKey,
    labels: labels(payload.labels),
  };
}

function readProperty(value: unknown): LictoryProperty | null {
  const v = value as Partial<LictoryProperty> | null | undefined;
  return v && typeof v.itemId === "string"
    ? {
        itemId: v.itemId,
        key: v.key ?? "",
        labels: Array.isArray(v.labels) ? v.labels : [],
      }
    : null;
}

function split(value: string | null | undefined) {
  return value ? value.split(/\s+/).filter(Boolean) : [];
}

// A local Jira stand-in (http://localhost) is accepted outside production so
// the export flow can be exercised end to end without a Jira Cloud site.
function localDevelopment(url: URL) {
  return (
    process.env.NODE_ENV !== "production" &&
    url.protocol === "http:" &&
    (url.hostname === "localhost" || url.hostname === "127.0.0.1")
  );
}
