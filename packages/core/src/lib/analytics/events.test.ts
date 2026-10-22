import assert from "node:assert/strict";
import { isWorkspacePath } from "@lictory/core/lib/paths";
import { describe, test } from "node:test";
import {
  commandSchema,
  type Command,
  type Entity,
} from "@lictory/core/contracts/protocol";
import {
  commandEvent,
  commandEvents,
  committedEvents,
  sanitizeAnalyticsUrl,
  sanitizeAnalyticsProperties,
  minimizeAnonymousAnalyticsProperties,
  setWorkspacePathMatcher,
} from "@lictory/core/lib/analytics/events";
import { publicationProperties } from "@lictory/core/lib/analytics/publication";
import { analyticsEventId } from "@lictory/core/lib/analytics/identity";

void describe("product analytics contract", () => {
  void test("every supported workspace command has an event", () => {
    const supported = commandSchema.options.map(
      (schema) => schema.shape.type.value,
    );
    assert.deepEqual(Object.keys(commandEvents).sort(), supported.sort());
  });

  void test("content and identities from user input never enter event properties", () => {
    const privateText =
      "Confidential customer data and unreleased architecture";
    const commands: Command[] = [
      {
        type: "updateSpecification",
        workItemId: "item",
        baseRevisionId: "r1",
        title: privateText,
        content: privateText,
        summary: privateText,
      },
      {
        type: "createThread",
        workItemId: "item",
        baseRevisionId: "r1",
        threadId: "thread",
        messageId: "message",
        body: privateText,
        quote: privateText,
        section: privateText,
        blocking: true,
      },
      {
        type: "createSuggestion",
        workItemId: "item",
        baseRevisionId: "r1",
        suggestionId: "suggestion",
        title: privateText,
        rationale: privateText,
        replacement: privateText,
        open: true,
      },
      {
        type: "createDiscipline",
        projectId: "project",
        disciplineId: "discipline",
        name: privateText,
        description: privateText,
        capabilities: {
          editSpecifications: true,
          changeProperties: true,
          requestReviews: true,
          review: true,
          publishDelivery: true,
        },
      },
    ];
    for (const command of commands)
      assert.ok(!JSON.stringify(commandEvent(command)).includes(privateText));
    assert.equal(commandEvent(commands[1]!).properties.blocking, true);
    assert.equal(commandEvent(commands[1]!).properties.anchored, true);
  });

  void test("readiness and stale approvals reflect committed transitions, not labels", () => {
    const item = (state: string) =>
      ({
        type: "workItem",
        id: "item",
        projectId: "project",
        teamId: "team",
        typeId: "epic",
        revisionId: "r1",
        statusId: "backlog",
        refinementState: state,
      }) as Entity;
    const approval = (status: string) =>
      ({ type: "approval", id: "approval", status }) as Entity;
    const command: Command = {
      type: "decideReview",
      workItemId: "item",
      baseRevisionId: "r1",
      reviewId: "review",
      decision: "approve",
    };
    const ready = committedEvents(
      command,
      [item("in_review")],
      [item("ready")],
    );
    assert.deepEqual(
      ready.map((event) => event.event),
      ["review_decided", "specification_ready"],
    );
    assert.equal(ready[0]!.properties.project_id, "project");
    assert.equal(ready[0]!.properties.revision_id, "r1");
    assert.equal(
      committedEvents(command, [item("ready")], [item("ready")]).length,
      1,
    );
    const changed = committedEvents(
      command,
      [item("ready"), approval("granted")],
      [item("in_review"), approval("stale")],
    );
    assert.deepEqual(
      changed.map((event) => event.event),
      [
        "review_decided",
        "specification_readiness_lost",
        "approvals_invalidated",
      ],
    );
  });

  void test("URLs exclude auth tokens, email addresses, queries and fragments", () => {
    assert.equal(
      sanitizeAnalyticsUrl(
        "https://lictory.app/reset-password?token=secret&email=a@example.com#private",
      ),
      "https://lictory.app/reset-password",
    );
    assert.equal(
      sanitizeAnalyticsUrl(
        "https://lictory.app/app/org/PAY/stories?q=customer+name",
      ),
      "https://lictory.app/app/org/PAY/stories",
    );
    assert.equal(sanitizeAnalyticsUrl("invalid"), "");
  });

  void test("partial publications retain each outcome without exporting Jira messages", () => {
    const properties = publicationProperties({
      id: "publication",
      status: "partial",
      results: {
        one: { outcome: "created", externalKey: "PRIVATE-1" },
        two: { outcome: "failed", message: "Secret Jira diagnostics" },
        three: { outcome: "conflict" },
      },
    });
    assert.equal(properties.publication_status, "partial");
    for (const field of ["created_count", "failed_count", "conflict_count"])
      assert.equal(properties[field], 1);
    assert.equal(properties.item_count, 3);
    assert.ok(!JSON.stringify(properties).includes("Secret"));
    assert.ok(!JSON.stringify(properties).includes("PRIVATE"));
  });
});

void test("automatic person properties and pageviews are sanitized before sending", () => {
  const properties = {
    $current_url: "https://app.example/reset-password?token=secret#private",
    $title: "Private work item title",
    ph_keyword: "Customer name",
    $set_once: {
      $initial_current_url:
        "https://app.example/verify-email?email=private@example.com&token=secret",
    },
    $set: {
      $initial_referrer: "https://search.example/?q=Customer+name",
      $initial_ph_keyword: "Customer name",
    },
  };
  sanitizeAnalyticsProperties(properties);
  assert.ok(!JSON.stringify(properties).includes("secret"));
  assert.ok(!JSON.stringify(properties).includes("private@example.com"));
  assert.ok(!JSON.stringify(properties).includes("Customer"));
  assert.ok(!JSON.stringify(properties).includes("Private"));
  assert.equal(properties.$current_url, "https://app.example/reset-password");
});

void test("retryable analytics has a valid stable event UUID scoped to the operation and actor", () => {
  const first = analyticsEventId("user", "attachment_uploaded", "org:file");
  assert.match(
    first,
    /^[0-9a-f]{8}-[0-9a-f]{4}-5[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/,
  );
  assert.equal(
    first,
    analyticsEventId("user", "attachment_uploaded", "org:file"),
  );
  assert.notEqual(
    first,
    analyticsEventId("other-user", "attachment_uploaded", "org:file"),
  );
  assert.notEqual(
    first,
    analyticsEventId("user", "attachment_removed", "org:file"),
  );
  assert.notEqual(
    first,
    analyticsEventId("user", "attachment_uploaded", "other-org:file"),
  );
});

void test("events without Analytics consent drop identifiers and workspace paths", () => {
  const properties: Record<string, unknown> = {
    organization_id: "org_1",
    work_item_id: "item_1",
    work_item_type: "Story",
    blocker_count: 2,
    distinct_id: "$posthog_cookieless",
    $session_id: "kept-by-posthog",
    $groups: { organization: "org_1" },
    $set: { email: "x" },
    $current_url: "https://app.example/app/acme/PAY-142",
    $pathname: "/app/acme/PAY-142",
    $referrer: "https://app.example/sign-in",
  };
  minimizeAnonymousAnalyticsProperties(properties);
  assert.deepEqual(properties, {
    work_item_type: "Story",
    blocker_count: 2,
    distinct_id: "$posthog_cookieless",
    $session_id: "kept-by-posthog",
    $current_url: "https://app.example/app",
    $pathname: "/app",
    $referrer: "https://app.example/sign-in",
  });
});

void test("the app host reduces every workspace path without Analytics consent", () => {
  setWorkspacePathMatcher(isWorkspacePath);
  try {
    const properties: Record<string, unknown> = {
      $current_url: "https://app.example/acme/pay/stories/PAY-142",
      $pathname: "/acme/pay/stories/PAY-142",
      $referrer: "https://app.example/sign-in?callbackUrl=%2Facme",
    };
    minimizeAnonymousAnalyticsProperties(properties);
    assert.equal(properties.$current_url, "https://app.example/app");
    assert.equal(properties.$pathname, "/app");
    assert.equal(
      properties.$referrer,
      "https://app.example/sign-in?callbackUrl=%2Facme",
    );
  } finally {
    setWorkspacePathMatcher((pathname) => /^\/app(\/|$)/.test(pathname));
  }
});
