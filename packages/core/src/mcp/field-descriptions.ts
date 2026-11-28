// Descriptions of the fields that mean the same thing in every MCP tool
// (identifiers, paging, ordering). A field described in its capability's
// schema keeps that description; these fill only the ones left blank, so a
// model and the generated reference never meet an undescribed identifier.
// A field whose meaning depends on the tool is described where the tool is
// defined: the capability test requires every field to have a description.

type Describe = string | ((tool: string) => string);

// Which family of objects a tool works on, for identifiers shared by
// specifications, pages and code (branches, pull requests, threads).
const family = (tool: string) =>
  /Page|Space|Draft$/.test(tool) && tool !== "commitSpecificationDraft"
    ? "page"
    : /Code|Repository/.test(tool)
      ? "code"
      : "specification";

const fields: Record<string, Describe> = {
  workItemId:
    "Work item id, or its key such as PAY-142 (listWorkItems shows both).",
  projectId: "Project id (from getWorkspace).",
  projectIds: "Project ids (from getWorkspace).",
  teamId: "Team id (from getWorkspace).",
  iterationId: "Iteration id (from getWorkspace).",
  statusId: "Workflow status id (from getWorkspace).",
  typeId: "Work item type id (from getWorkspace).",
  childTypeId: "Work item type id of the children (from getWorkspace).",
  disciplineId: "Discipline id (from getWorkspace).",
  milestoneId: "Milestone id (from listMilestones).",
  labelIds: "Label ids (from listLabels).",
  userId: "A member's user id (from getWorkspace or searchMembers).",
  userIds: "Members' user ids (from getWorkspace or searchMembers).",
  assigneeId:
    "User id of the person to assign (from searchMembers); null unassigns.",
  agentIds: "Agent ids (from listAgents).",
  channelId: "Channel id (from listChannels).",
  messageId: "Message id (from readChannel or readChannelThread).",
  rootMessageId: "Id of the message that starts the thread (from readChannel).",
  spaceId: "Space id (from listSpaces).",
  pageId: "Page id (from listPages).",
  repositoryId: "Linked repository id (from listCodeRepositories).",
  connectionId: (tool) =>
    family(tool) === "code"
      ? "Code host connection id (from listCodeRepositories)."
      : "Delivery tool connection id (from getWorkspace delivery targets).",
  suggestionId: "Suggestion id (from getWorkItem).",
  reviewId: "Review id (from getWorkItem).",
  entryId: "Context entry id (from listIntelligenceContext).",
  writeId:
    "Id of the write Lictory sends to the code host (returned by the write tool, or getWorkItemCode).",
  linkId: (tool) =>
    family(tool) === "code"
      ? "Code link id (from getWorkItemCode)."
      : "Context page link id (from listContextPages).",
  draftId: "Live draft id (returned when the draft was opened).",
  pullRequestId: (tool) =>
    family(tool) === "code"
      ? "Mirrored code pull request id (from listCodePullRequests or getWorkItemCode)."
      : family(tool) === "page"
        ? "Page pull request id (returned by createPagePullRequest)."
        : "Specification pull request id (from getWorkItem).",
  branchId: (tool) =>
    family(tool) === "page"
      ? "Page branch id (returned by createPageBranch)."
      : "Specification branch id (from getWorkItem).",
  fromBranchId: (tool) =>
    family(tool) === "page"
      ? "Page branch to bring changes from (returned by createPageBranch)."
      : "Specification branch to start from or bring changes from (from getWorkItem).",
  threadId: (tool) =>
    family(tool) === "page"
      ? "Page discussion id (from listPageThreads)."
      : "Discussion id (from getWorkItem).",
  commitId: "Page commit id (from listPageCommits or getPage).",
  baseRevisionId:
    "The current revision id you read (getWorkItem). If the item changed since, the call is refused as a conflict with currentRevisionId, so nothing is applied to text you have not seen.",
  limit: "Most results to return.",
  offset: "Results to skip, for paging.",
  beforeId:
    "Place it directly before this sibling (same list). Omit both beforeId and afterId to place it last.",
  afterId:
    "Place it directly after this sibling (same list). Omit both beforeId and afterId to place it last.",
  includeArchived: "Also return archived ones.",
  archived: "true archives it; false restores it.",
  query: "Text to search for.",
  q: "Text to search for.",
};

export function describedField(tool: string, field: string) {
  const description = fields[field];
  return typeof description === "function" ? description(tool) : description;
}

// Fills blank descriptions in a tool's JSON schema, nested objects included.
export function describeFields(tool: string, schema: unknown) {
  const visit = (node: unknown) => {
    if (!node || typeof node !== "object") return;
    const object = node as Record<string, unknown>;
    const properties = object.properties as
      Record<string, Record<string, unknown>> | undefined;
    for (const [name, property] of Object.entries(properties ?? {})) {
      const own =
        property.description ??
        (property.anyOf as Record<string, unknown>[] | undefined)?.find(
          (variant) => variant.description,
        )?.description;
      const shared = own ? undefined : describedField(tool, name);
      if (shared) property.description = shared;
      visit(property);
    }
    visit(object.items);
    for (const variant of (object.anyOf ?? object.oneOf ?? []) as unknown[])
      visit(variant);
  };
  visit(schema);
  return schema;
}
