import { describe, expect, it } from "vitest";
import { checkEnvironment, summarise } from "./env-check";

const good = {
  NODE_ENV: "production",
  VERCEL: "1",
  DATABASE_URL: "postgresql://u:p@ep-x-pooler.c-3.ap-southeast-1.aws.neon.tech/db?sslmode=require",
  AUTH_SECRET: "a".repeat(44),
  ENCRYPTION_KEY: "b".repeat(64),
  ANTHROPIC_API_KEY: "sk-ant-abc",
  VIATOR_SANDBOX_KEY: "v",
  TRAVELDESK_API_KEY: "t",
  MAPBOX_API_KEY: "pk.abc",
};
const names = (env: Record<string, string | undefined>, level?: "error" | "warning") =>
  checkEnvironment(env).filter((i) => !level || i.level === level).map((i) => i.name);

describe("checkEnvironment", () => {
  it("a complete, healthy production setup has no problems", () => {
    expect(checkEnvironment(good)).toEqual([]);
  });

  it("flags missing core secrets as errors", () => {
    const issues = names({ NODE_ENV: "production", VERCEL: "1" }, "error");
    expect(issues).toEqual(expect.arrayContaining(["DATABASE_URL", "AUTH_SECRET", "ENCRYPTION_KEY"]));
    expect(summarise(checkEnvironment({ NODE_ENV: "production", VERCEL: "1" })).errors).toBeGreaterThanOrEqual(3);
  });

  it("catches the missing AUTH_TRUST_HOST that made every login return 500 outside Vercel", () => {
    const env = { ...good, VERCEL: undefined };
    expect(names(env, "error")).toContain("AUTH_TRUST_HOST");
    expect(names({ ...env, AUTH_TRUST_HOST: "true" }, "error")).not.toContain("AUTH_TRUST_HOST");
    expect(names({ ...env, AUTH_URL: "https://app.example.com" }, "error")).not.toContain("AUTH_TRUST_HOST");
    // Not needed in development.
    expect(names({ ...env, NODE_ENV: "development" }, "error")).not.toContain("AUTH_TRUST_HOST");
  });

  it("catches a model display name used as a model id", () => {
    expect(names({ ...good, ANTHROPIC_MODEL: "Claude Fable 5.2" }, "error")).toContain("ANTHROPIC_MODEL");
    expect(names({ ...good, ANTHROPIC_MODEL: "claude-fable-5-2" })).not.toContain("ANTHROPIC_MODEL");
  });

  it("catches an API key pasted with extra quotes", () => {
    expect(names({ ...good, MAPBOX_API_KEY: '"pk.abc"' }, "error")).toContain("MAPBOX_API_KEY");
    expect(names({ ...good, OPENAI_API_KEY: "sk-abc " }, "error")).toEqual([]); // trailing space is trimmed, not an error
    expect(names({ ...good, OPENAI_API_KEY: "sk abc" }, "error")).toContain("OPENAI_API_KEY");
  });

  it("accepts the encryption key as hex or base64 and rejects other lengths", () => {
    expect(names({ ...good, ENCRYPTION_KEY: Buffer.alloc(32, 1).toString("base64") }, "error")).not.toContain("ENCRYPTION_KEY");
    expect(names({ ...good, ENCRYPTION_KEY: "tooshort" }, "error")).toContain("ENCRYPTION_KEY");
  });

  it("rejects a short AUTH_SECRET and a malformed DATABASE_URL", () => {
    expect(names({ ...good, AUTH_SECRET: "short" }, "error")).toContain("AUTH_SECRET");
    expect(names({ ...good, DATABASE_URL: "not a url" }, "error")).toContain("DATABASE_URL");
  });

  it("warns when the app points at the direct Neon host instead of the pooled one", () => {
    expect(names({ ...good, DATABASE_URL: "postgresql://u:p@ep-x.c-3.ap-southeast-1.aws.neon.tech/db" }, "warning")).toContain("DATABASE_URL");
  });

  it("never lets a production Viator setting without its key through, and warns about absent suppliers", () => {
    expect(names({ ...good, VIATOR_API_ENV: "production" }, "error")).toContain("VIATOR_PRODUCTION_KEY");
    const warnings = names({ ...good, ANTHROPIC_API_KEY: undefined, TRAVELDESK_API_KEY: undefined, MAPBOX_API_KEY: undefined }, "warning");
    expect(warnings).toEqual(expect.arrayContaining(["ANTHROPIC_API_KEY", "TRAVELDESK_API_KEY", "MAPBOX_API_KEY"]));
  });

  it("warns that a secret Mapbox token is kept off the browser", () => {
    expect(checkEnvironment({ ...good, MAPBOX_API_KEY: "sk.secret" }).find((i) => i.name === "MAPBOX_API_KEY")?.message).toMatch(/OpenStreetMap/);
  });

  it("flags live bookings being switched on, and admin 2FA being waived in production", () => {
    expect(names({ ...good, TRAVELDESK_API_ENV: "production", TRAVELDESK_ALLOW_LIVE_BOOKING: "true" }, "warning")).toContain("TRAVELDESK_ALLOW_LIVE_BOOKING");
    expect(names({ ...good, SUPERADMIN_ALLOW_NO_MFA: "true" }, "error")).toContain("SUPERADMIN_ALLOW_NO_MFA");
    expect(names({ ...good, NODE_ENV: "development", SUPERADMIN_ALLOW_NO_MFA: "true" }, "error")).not.toContain("SUPERADMIN_ALLOW_NO_MFA");
  });

  it("never includes a secret value in what it returns", () => {
    const text = JSON.stringify(checkEnvironment({ ...good, AUTH_SECRET: "short-secret-value", ENCRYPTION_KEY: "very-secret-key-value" }));
    expect(text).not.toContain("short-secret-value");
    expect(text).not.toContain("very-secret-key-value");
  });
});
