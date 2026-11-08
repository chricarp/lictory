import { Hono, type Context } from "hono";
import { z } from "zod";
import { db } from "@lictory/core/db";
import { checkAiProvider } from "@lictory/core/ai/check";
import {
  describeAiProvider,
  describeTranscription,
} from "@lictory/core/ai/provider-settings";
import {
  aiSettingsInput,
  aiSettingsView,
  candidateState,
  saveAiSettings,
} from "@lictory/core/domain/ai-settings";
import {
  addOrganizationMember,
  createAccount,
  createOrganization,
  instanceOverview,
  InstanceAdminError,
  listInstanceAudit,
  listOrganizations,
  listUsers,
  requireInstanceAdmin,
  sendPasswordReset,
  setDeactivated,
  setInstanceAdmin,
  setPassword,
  userByEmail,
  type InstanceActor,
} from "@lictory/core/domain/instance-admin";
import { noStore } from "@lictory/api/middleware";

// The admin console's API: instance administration for signed-in instance
// administrators only. Every handler authorizes against the verified session
// before reading anything (domain/instance-admin.ts records each change).
// Writes are same-origin through the /api/* middleware in app.ts.

const role = z.enum(["owner", "admin", "member"]);
const createUserBody = z.object({
  name: z.string().trim().min(1).max(120),
  email: z.email().max(320),
  password: z.string().min(1).max(200).optional(),
  instanceAdmin: z.boolean().optional(),
  organization: z
    .object({ id: z.string().min(1).max(160), role: role.default("member") })
    .optional(),
});
// People are named by account id or email (the console's forms take emails).
const person = {
  userId: z.string().min(1).max(160).optional(),
  email: z.email().max(320).optional(),
};
const createOrganizationBody = z.object({
  name: z.string().trim().min(1).max(80),
  slug: z.string().trim().max(60).optional(),
  owner: z.object(person),
});
const memberBody = z.object({ ...person, role: role.default("member") });

async function personId(input: { userId?: string; email?: string }) {
  if (input.userId) return input.userId;
  if (input.email) return (await userByEmail(db, input.email)).id;
  throw new InstanceAdminError("validation", "Choose a person by email.");
}
const flagBody = (key: string) => z.object({ [key]: z.boolean() });
const passwordBody = z.object({ password: z.string().min(1).max(200) });

function failure(error: unknown) {
  if (error instanceof InstanceAdminError)
    return Response.json(
      { error: { code: error.code, message: error.message } },
      { status: error.status, headers: noStore },
    );
  throw error;
}

async function body<T>(c: Context, schema: z.ZodType<T>) {
  const parsed = schema.safeParse(await c.req.json().catch(() => null));
  if (!parsed.success)
    throw new InstanceAdminError(
      "validation",
      parsed.error.issues[0]?.message ?? "Check the form and try again.",
    );
  return parsed.data;
}

// Authorizes, then runs the handler with the acting administrator.
function admin(
  handler: (c: Context, actor: InstanceActor) => Promise<unknown>,
) {
  return async (c: Context) => {
    try {
      const user = await requireInstanceAdmin(c.req.raw.headers);
      const result = await handler(c, { user, via: "web" });
      return Response.json(result ?? { ok: true }, { headers: noStore });
    } catch (error) {
      return failure(error);
    }
  };
}

// One live AI check at a time per API process, and not more than one every
// ten seconds: each check costs a few model calls. A check reaches only the
// configured provider, or the candidate an instance administrator is about
// to save (its endpoint guarded like a saved one).
let aiCheck: { running: boolean; at: number } = { running: false, at: 0 };
async function limitedCheck<T>(run: () => Promise<T>) {
  if (aiCheck.running)
    throw new InstanceAdminError(
      "busy",
      "A check of the AI provider is already running. Wait for its result.",
      409,
    );
  if (Date.now() - aiCheck.at < 10_000)
    throw new InstanceAdminError(
      "busy",
      "The AI provider was just checked. Try again in a few seconds.",
      409,
    );
  aiCheck = { running: true, at: Date.now() };
  try {
    return await run();
  } finally {
    aiCheck = { running: false, at: Date.now() };
  }
}

export function adminRoutes() {
  const app = new Hono();

  const aiView = async () => ({
    ...(await aiSettingsView(db)),
    text: describeAiProvider(),
    dictation: describeTranscription(),
  });
  app.get("/api/admin/ai", admin(aiView));

  app.put(
    "/api/admin/ai",
    admin(async (c, actor) => {
      await saveAiSettings(db, actor, await body(c, aiSettingsInput));
      return aiView();
    }),
  );

  // Tests settings before they are saved; nothing is stored.
  app.post(
    "/api/admin/ai/test",
    admin(async (c) => {
      const input = await body(c, aiSettingsInput);
      const { state, problems } = await candidateState(db, input);
      if (problems.length)
        throw new InstanceAdminError("validation", problems.join(" "));
      return limitedCheck(() =>
        checkAiProvider({
          text: state.text,
          transcription: state.transcription,
        }),
      );
    }),
  );

  app.post(
    "/api/admin/ai/check",
    admin(() => limitedCheck(() => checkAiProvider())),
  );

  app.get(
    "/api/admin/overview",
    admin(() => instanceOverview(db)),
  );

  app.get(
    "/api/admin/users",
    admin((c) => {
      const status = c.req.query("status");
      return listUsers(db, {
        query: c.req.query("query")?.slice(0, 200),
        status:
          status === "active" ||
          status === "deactivated" ||
          status === "administrators"
            ? status
            : "all",
        offset: Number(c.req.query("offset") ?? 0) || 0,
      });
    }),
  );

  app.post(
    "/api/admin/users",
    admin(async (c, actor) =>
      createAccount(db, actor, await body(c, createUserBody)),
    ),
  );

  app.post(
    "/api/admin/users/:id/administrator",
    admin(async (c, actor) => {
      const { instanceAdmin } = (await body(c, flagBody("instanceAdmin"))) as {
        instanceAdmin: boolean;
      };
      return {
        user: await setInstanceAdmin(
          db,
          actor,
          c.req.param("id")!,
          instanceAdmin,
        ),
      };
    }),
  );

  app.post(
    "/api/admin/users/:id/deactivation",
    admin(async (c, actor) => {
      const { deactivated } = (await body(c, flagBody("deactivated"))) as {
        deactivated: boolean;
      };
      return {
        user: await setDeactivated(db, actor, c.req.param("id")!, deactivated),
      };
    }),
  );

  app.post(
    "/api/admin/users/:id/password",
    admin(async (c, actor) => {
      const { password } = await body(c, passwordBody);
      return {
        user: await setPassword(db, actor, c.req.param("id")!, password),
      };
    }),
  );

  app.post(
    "/api/admin/users/:id/password-reset",
    admin(async (c, actor) => ({
      user: await sendPasswordReset(db, actor, c.req.param("id")!),
    })),
  );

  app.get(
    "/api/admin/organizations",
    admin(async () => ({ organizations: await listOrganizations(db) })),
  );

  app.post(
    "/api/admin/organizations",
    admin(async (c, actor) => {
      const { owner, ...input } = await body(c, createOrganizationBody);
      return {
        organization: await createOrganization(db, actor, {
          ...input,
          ownerId: await personId(owner),
        }),
      };
    }),
  );

  app.post(
    "/api/admin/organizations/:id/members",
    admin(async (c, actor) => {
      const input = await body(c, memberBody);
      return {
        organization: await addOrganizationMember(db, actor, {
          organizationId: c.req.param("id")!,
          userId: await personId(input),
          role: input.role,
        }),
      };
    }),
  );

  app.get(
    "/api/admin/activity",
    admin((c) => {
      return listInstanceAudit(db, {
        before: c.req.query("before")?.slice(0, 200),
      });
    }),
  );

  return app;
}
