#!/usr/bin/env node
/**
 * Grant or revoke platform-administrator access. Run it from a trusted shell that can reach the database:
 *
 *   npm run admin:grant  -- someone@example.com
 *   npm run admin:revoke -- someone@example.com
 *
 * There is deliberately no web screen for this: nobody can make themselves an administrator through the app.
 * The person must already have an account, and must turn on two-factor authentication
 * (Settings > Security) before the admin console will let them in.
 */
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
try {
  require("dotenv").config({ path: ".env.local", quiet: true });
  require("dotenv").config({ quiet: true });
} catch {
  // dotenv is optional: DATABASE_URL may already be in the environment.
}

const [, , action, rawEmail] = process.argv;
if (!["grant", "revoke"].includes(action ?? "") || !rawEmail) {
  console.error("Usage: node scripts/admin-flag.mjs <grant|revoke> <email>");
  process.exit(2);
}
const email = rawEmail.trim().toLowerCase();
const url = process.env.DATABASE_URL_UNPOOLED || process.env.DATABASE_URL;
if (!url) {
  console.error("DATABASE_URL is not set.");
  process.exit(2);
}

const { Pool } = require("pg");
const pool = new Pool({ connectionString: url, connectionTimeoutMillis: 20_000 });
try {
  const found = await pool.query('SELECT id, "isSuperAdmin", "totpEnabled" FROM "User" WHERE email = $1', [email]);
  if (found.rowCount === 0) {
    console.error(`No account with the email ${email}. They must register first.`);
    process.exit(1);
  }
  const user = found.rows[0];
  const makeAdmin = action === "grant";
  if (user.isSuperAdmin === makeAdmin) {
    console.log(`${email} is already ${makeAdmin ? "a platform administrator" : "not a platform administrator"}. Nothing changed.`);
  } else {
    await pool.query('UPDATE "User" SET "isSuperAdmin" = $2, "updatedAt" = now() WHERE id = $1', [user.id, makeAdmin]);
    await pool.query(
      'INSERT INTO "AuditLog" (id, "userId", action, entity, "entityId", metadata) VALUES (gen_random_uuid()::text, $1, $2, \'User\', $1, $3)',
      [user.id, makeAdmin ? "admin.super_admin_granted" : "admin.super_admin_revoked", JSON.stringify({ by: "command_line" })]
    );
    console.log(`${email} is now ${makeAdmin ? "a platform administrator" : "no longer a platform administrator"}.`);
  }
  if (makeAdmin && !user.totpEnabled) {
    console.log("Reminder: they must enable two-factor authentication in Settings > Security before the admin console opens.");
  }
} finally {
  await pool.end();
}
