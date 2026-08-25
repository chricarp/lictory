import { defineConfig } from "drizzle-kit";

export default defineConfig({
  dialect: "sqlite",
  schema: "./src/infrastructure/database/schema.ts",
  out: "./migrations",
  strict: true,
  verbose: true,
});
