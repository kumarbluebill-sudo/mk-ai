import "dotenv/config";
import { defineConfig } from "prisma/config";

export default defineConfig({
  schema: "prisma/schema.prisma",
  migrations: { path: "prisma/migrations" },
  datasource: {
    // Generation and builds don't need a database connection. The placeholder is
    // only used when DATABASE_URL hasn't been configured for an actual DB command.
    url: process.env.DATABASE_URL ?? "postgresql://postgres:postgres@127.0.0.1:5432/mk_ai_travel?schema=public",
  },
});
