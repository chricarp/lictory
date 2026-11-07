// A stand-in for Jira Cloud's REST API v3, for browser workflows that hand
// work off (tests/platform/external-delivery.spec.ts). It implements the
// endpoints the real adapter calls (packages/core/src/delivery/jira) with
// Jira's shapes, so publishing, recovery and the status sync run unchanged
// against it. A test drives the "people working in Jira" side through
// /__fake/*: creating a project, moving an issue through its workflow and
// losing the answer to the next create (the response never arrives, but the
// issue exists, as after a timeout).
//
// It runs inside scripts/test-e2e.ts on 127.0.0.1 and is reached only through
// route-fake-sites.ts, which that script preloads into the API and worker it
// starts. Production images contain neither file.
import { json, listen, send } from "./http";

export const FAKE_JIRA_SITE = "https://lictory-e2e.atlassian.net";
export const FAKE_JIRA_CREDENTIAL = {
  email: "jira-bot@example.test",
  apiToken: "e2e-fake-jira-token",
};

type Category = "new" | "indeterminate" | "done";
type Issue = {
  id: string;
  key: string;
  projectId: string;
  typeId: string;
  summary: string;
  description: unknown;
  labels: string[];
  parentId: string | null;
  status: string;
  category: Category;
  assignee: string | null;
  created: Date;
  updated: Date;
  property: unknown;
  remoteLinks: unknown[];
};
type Project = {
  id: string;
  key: string;
  name: string;
  loseNextCreate: boolean;
};

const issueTypes = [
  { id: "10000", name: "Epic", subtask: false, hierarchyLevel: 1 },
  { id: "10001", name: "Story", subtask: false, hierarchyLevel: 0 },
  { id: "10002", name: "Task", subtask: false, hierarchyLevel: 0 },
  { id: "10003", name: "Subtask", subtask: true, hierarchyLevel: -1 },
];
const PROPERTY = "lictory.item";

export async function startFakeJira(port: number) {
  const projects = new Map<string, Project>();
  const issues = new Map<string, Issue>();
  let projectSequence = 10_000;
  let sequence = 20_000;
  const authorization = `Basic ${Buffer.from(
    `${FAKE_JIRA_CREDENTIAL.email}:${FAKE_JIRA_CREDENTIAL.apiToken}`,
  ).toString("base64")}`;

  const project = (idOrKey: string) =>
    projects.get(idOrKey) ??
    [...projects.values()].find((p) => p.id === idOrKey);
  const issue = (idOrKey: string) =>
    issues.get(idOrKey) ?? [...issues.values()].find((i) => i.key === idOrKey);
  const view = (i: Issue) => ({
    id: i.id,
    key: i.key,
    self: `${FAKE_JIRA_SITE}/rest/api/3/issue/${i.id}`,
    fields: {
      summary: i.summary,
      status: { name: i.status, statusCategory: { key: i.category } },
      assignee: i.assignee ? { displayName: i.assignee } : null,
      issuetype: { id: i.typeId },
      ...(i.parentId ? { parent: { id: i.parentId } } : {}),
      labels: i.labels,
      updated: i.updated.toISOString(),
    },
    properties: i.property ? { [PROPERTY]: i.property } : {},
  });
  const notFound = (message: string) => ({ errorMessages: [message] });

  return listen(port, async (request, response) => {
    const url = new URL(request.url, "http://fake");
    const path = url.pathname;
    const method = request.method;
    const body = json<Record<string, unknown>>(request.body) ?? {};
    if (process.env.E2E_VERBOSE) console.log(`[fake jira] ${method} ${path}`);

    // The test's side: what people do in Jira.
    if (path.startsWith("/__fake/")) {
      let match: RegExpExecArray | null;
      if (method === "POST" && path === "/__fake/projects") {
        const key = String(body.key);
        if (!projects.has(key))
          projects.set(key, {
            id: String(++projectSequence),
            key,
            name: typeof body.name === "string" ? body.name : key,
            loseNextCreate: false,
          });
        return send(response, 200, projects.get(key));
      }
      if (
        method === "POST" &&
        (match = /^\/__fake\/projects\/([^/]+)\/lose-next-create$/.exec(path))
      ) {
        const found = project(decodeURIComponent(match[1]!));
        if (!found) return send(response, 404, notFound("No such project"));
        found.loseNextCreate = true;
        return send(response, 204);
      }
      if (method === "GET" && path === "/__fake/issues") {
        const key = url.searchParams.get("project");
        const id = key ? project(key)?.id : undefined;
        return send(
          response,
          200,
          [...issues.values()]
            .filter((i) => !key || i.projectId === id)
            .map((i) => ({
              id: i.id,
              key: i.key,
              summary: i.summary,
              status: i.status,
              assignee: i.assignee,
              labels: i.labels,
              lictoryItemId:
                (i.property as { itemId?: string } | null)?.itemId ?? null,
              remoteLinks: i.remoteLinks.length,
            })),
        );
      }
      if (
        method === "POST" &&
        (match = /^\/__fake\/issues\/([^/]+)\/progress$/.exec(path))
      ) {
        const found = issue(decodeURIComponent(match[1]!));
        if (!found) return send(response, 404, notFound("No such issue"));
        found.status = String(body.status);
        found.category = body.category as Category;
        found.assignee = (body.assignee as string | null) ?? null;
        found.updated = new Date();
        return send(response, 204);
      }
      return send(response, 404, notFound(`No fake route ${method} ${path}`));
    }

    if (request.headers.authorization !== authorization)
      return send(response, 401, {
        errorMessages: [
          "Client must be authenticated to access this resource.",
        ],
      });

    if (method === "GET" && path === "/rest/api/3/myself")
      return send(response, 200, {
        accountId: "e2e-account",
        displayName: "Jira Bot",
        emailAddress: FAKE_JIRA_CREDENTIAL.email,
      });
    if (method === "GET" && path === "/rest/api/3/project/search") {
      const query = url.searchParams.get("query")?.toLowerCase() ?? "";
      return send(response, 200, {
        values: [...projects.values()]
          .filter(
            (p) =>
              p.key.toLowerCase().includes(query) ||
              p.name.toLowerCase().includes(query),
          )
          .map(({ id, key, name }) => ({ id, key, name })),
        isLast: true,
      });
    }
    let match: RegExpExecArray | null;
    if (
      method === "GET" &&
      (match = /^\/rest\/api\/3\/project\/([^/]+)$/.exec(path))
    ) {
      const found = project(decodeURIComponent(match[1]!));
      if (!found) return send(response, 404, notFound("No project found."));
      return send(response, 200, {
        id: found.id,
        key: found.key,
        name: found.name,
        issueTypes,
      });
    }
    if (
      method === "GET" &&
      /^\/rest\/api\/3\/issue\/createmeta\/[^/]+\/issuetypes\/[^/]+$/.test(path)
    )
      // Only fields Lictory fills are required.
      return send(response, 200, {
        fields: [
          { fieldId: "summary", name: "Summary", required: true },
          { fieldId: "issuetype", name: "Issue Type", required: true },
          { fieldId: "project", name: "Project", required: true },
        ],
      });
    if (method === "POST" && path === "/rest/api/3/search/jql") {
      const jql = typeof body.jql === "string" ? body.jql : "";
      const byId = /^id in \(([\d,\s]+)\)$/.exec(jql);
      const recent =
        /^project = (\S+) AND reporter = currentUser\(\) AND created >= -(\d+)m ORDER BY created DESC$/.exec(
          jql,
        );
      let found: Issue[];
      if (byId) {
        const ids = new Set(byId[1]!.split(",").map((s) => s.trim()));
        found = [...issues.values()].filter((i) => ids.has(i.id));
      } else if (recent) {
        const projectId = project(recent[1]!)?.id;
        const since = Date.now() - Number(recent[2]) * 60_000;
        found = [...issues.values()]
          .filter((i) => i.projectId === projectId && +i.created >= since)
          .sort((a, b) => +b.created - +a.created);
      } else
        return send(response, 400, {
          errorMessages: [`The fake Jira does not understand the JQL ${jql}`],
        });
      return send(response, 200, { issues: found.map(view), isLast: true });
    }
    if (method === "POST" && path === "/rest/api/3/issue") {
      const fields = (body.fields ?? {}) as Record<string, unknown>;
      const target = project(String((fields.project as { id?: string })?.id));
      if (!target)
        return send(response, 400, {
          errors: { project: "valid project is required" },
        });
      const id = String(++sequence);
      const now = new Date();
      const created: Issue = {
        id,
        key: `${target.key}-${[...issues.values()].filter((i) => i.projectId === target.id).length + 1}`,
        projectId: target.id,
        typeId: String((fields.issuetype as { id?: string })?.id),
        summary: typeof fields.summary === "string" ? fields.summary : "",
        description: fields.description ?? null,
        labels: (fields.labels as string[] | undefined) ?? [],
        parentId: (fields.parent as { id?: string } | undefined)?.id ?? null,
        status: "To Do",
        category: "new",
        assignee: null,
        created: now,
        updated: now,
        property:
          (
            body.properties as { key: string; value: unknown }[] | undefined
          )?.find((p) => p.key === PROPERTY)?.value ?? null,
        remoteLinks: [],
      };
      issues.set(id, created);
      // The issue exists, but its answer is lost on the way back.
      if (target.loseNextCreate) {
        target.loseNextCreate = false;
        return send(response, 502, { errorMessages: ["Bad gateway"] });
      }
      return send(response, 201, {
        id,
        key: created.key,
        self: `${FAKE_JIRA_SITE}/rest/api/3/issue/${id}`,
      });
    }
    if ((match = /^\/rest\/api\/3\/issue\/([^/]+)(\/.*)?$/.exec(path))) {
      const found = issue(decodeURIComponent(match[1]!));
      if (!found)
        return send(
          response,
          404,
          notFound(
            "Issue does not exist or you do not have permission to see it.",
          ),
        );
      const rest = match[2] ?? "";
      if (method === "GET" && rest === "")
        return send(response, 200, view(found));
      if (method === "PUT" && rest === "") {
        const fields = (body.fields ?? {}) as Record<string, unknown>;
        if (typeof fields.summary === "string") found.summary = fields.summary;
        if ("description" in fields) found.description = fields.description;
        const parent = fields.parent as { id?: string } | undefined;
        if (parent?.id) found.parentId = parent.id;
        const ops =
          (body.update as { labels?: { add?: string; remove?: string }[] })
            ?.labels ?? [];
        for (const op of ops) {
          if (op.add && !found.labels.includes(op.add))
            found.labels.push(op.add);
          if (op.remove)
            found.labels = found.labels.filter((l) => l !== op.remove);
        }
        found.updated = new Date();
        return send(response, 204);
      }
      if (method === "PUT" && rest === `/properties/${PROPERTY}`) {
        found.property = body;
        return send(response, 200, {});
      }
      if (method === "GET" && rest === "/changelog")
        // Nobody edits Lictory's fields in this Jira.
        return send(response, 200, {
          values: [],
          isLast: true,
          maxResults: 100,
        });
      if (method === "POST" && rest === "/remotelink") {
        found.remoteLinks = [
          ...found.remoteLinks.filter(
            (l) => (l as { globalId?: string }).globalId !== body.globalId,
          ),
          body,
        ];
        return send(response, 201, { id: found.remoteLinks.length });
      }
    }
    return send(response, 404, notFound(`No fake route ${method} ${path}`));
  });
}
