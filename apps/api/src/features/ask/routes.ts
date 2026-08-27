import { createAskRequestSchema } from "@lictory/contracts";
import { Hono } from "hono";

import type { AppBindings } from "../../bindings";
import { errorBody } from "../../http/errors";
import {
  createAskQuery,
  deleteAskQuery,
  listAskQueries,
  loadAskQuery,
} from "./service";

const asks = new Hono<AppBindings>();

asks.get("/", async (c) =>
  c.json({ queries: await listAskQueries(c.env, c.get("userId")) }),
);

asks.post("/", async (c) => {
  const parsed = createAskRequestSchema.safeParse(
    await c.req.json().catch(() => ({})),
  );
  if (!parsed.success) {
    return c.json(
      errorBody(
        "invalid_question",
        "The question is invalid",
        c.get("requestId"),
        parsed.error.flatten(),
      ),
      400,
    );
  }
  const query = await createAskQuery(
    c.env,
    c.get("userId"),
    parsed.data.question,
  );
  return c.json({ query }, 201);
});

asks.get("/:queryId", async (c) => {
  const query = await loadAskQuery(
    c.env,
    c.get("userId"),
    c.req.param("queryId"),
  );
  if (!query) {
    return c.json(
      errorBody("ask_not_found", "Question not found", c.get("requestId")),
      404,
    );
  }
  return c.json({ query });
});

asks.delete("/:queryId", async (c) => {
  const deleted = await deleteAskQuery(
    c.env,
    c.get("userId"),
    c.req.param("queryId"),
  );
  if (!deleted) {
    return c.json(
      errorBody("ask_not_found", "Question not found", c.get("requestId")),
      404,
    );
  }
  return c.body(null, 204);
});

export { asks as askRoutes };
