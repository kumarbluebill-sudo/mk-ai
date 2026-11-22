import pg from "pg";
import { e2eDatabase } from "./database";

/**
 * Fails the whole run before any test starts if the database choice is unsafe, and clears the rate-limit
 * counters so a previous run in the same hour cannot make this one fail with 429 (the limits are shared
 * through the database and last up to an hour).
 */
export default async function globalSetup(): Promise<void> {
  const db = e2eDatabase();
  console.log(`E2E database host: ${new URL(db.direct).host}`);
  const client = new pg.Client({ connectionString: db.direct });
  await client.connect();
  try {
    await client.query('DELETE FROM "RateLimitBucket"');
  } finally {
    await client.end();
  }
}
