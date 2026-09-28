import "dotenv/config";

import { defineConfig } from "drizzle-kit";

const directUrl = process.env.DATABASE_URL_UNPOOLED?.trim();

export default defineConfig({
  dialect: "postgresql",
  schema: "./src/db/schema.ts",
  out: "./drizzle",
  dbCredentials: {
    url:
      (directUrl?.length ? directUrl : undefined) ??
      process.env.DATABASE_URL ??
      "postgresql://lictory:lictory@localhost:5432/lictory",
  },
  strict: true,
  verbose: true,
});
