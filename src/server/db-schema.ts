/**
 * A database that has not had the latest migrations applied fails with Prisma "table/column does not
 * exist" errors (P2021 / P2022). Recognising them lets the app say what is wrong instead of a bare 500.
 */
export const SCHEMA_OUT_OF_DATE_MESSAGE =
  "The server database is not up to date, so sign-up cannot finish. The administrator must run the database migration (npx prisma migrate deploy) and try again.";

export function isSchemaMismatch(error: unknown): boolean {
  if (typeof error !== "object" || error === null || !("code" in error)) return false;
  const code = (error as { code?: unknown }).code;
  return code === "P2021" || code === "P2022";
}
