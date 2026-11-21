import { e2eDatabase } from "./database";

/** Fails the whole run before any test starts if the database choice is unsafe. */
export default function globalSetup(): void {
  const db = e2eDatabase();
  const host = new URL(db.direct).host;
  console.log(`E2E database host: ${host}`);
}
