import { config } from "dotenv";
import { defineConfig } from "prisma/config";

// Next.js reads .env.local itself; the Prisma CLI does not, so load it here.
config({ path: ".env.local" });
config();

export default defineConfig({
  schema: "prisma/schema.prisma",
  migrations: { path: "prisma/migrations" },
  datasource: {
    // The CLI (migrate, db push) needs a direct, non-pooled connection: PgBouncer in
    // transaction mode breaks Prisma Migrate. The app itself uses the pooled DATABASE_URL
    // (src/lib/prisma.ts). Generation and builds don't connect; the placeholder is only
    // used when no database is configured.
    url:
      process.env.DATABASE_URL_UNPOOLED ??
      process.env.DATABASE_URL ??
      "postgresql://postgres:postgres@127.0.0.1:5432/mk_ai_travel?schema=public",
  },
});
