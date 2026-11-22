import { beforeEach, describe, expect, it, vi } from "vitest";
import type { PrismaClient } from "@/generated/prisma/client";
import { clearSupplierSettingsCache, disabledSuppliers, listSupplierAdmin, recordCall, setSupplierEnabled, SupplierAdminError, supplierEnvironment, testSupplier } from "./settings";
import { clearSearchCache } from "./search";
import type { SupplierAdapter } from "./types";

const adapter = (id: string, over: Partial<SupplierAdapter> = {}): SupplierAdapter => ({
  id,
  displayName: id.toUpperCase(),
  categories: ["activity"],
  isConfigured: () => true,
  notConfiguredReason: () => "needs a key",
  search: async () => ({ items: [], environment: "sandbox" }),
  ...over,
});

beforeEach(() => {
  clearSupplierSettingsCache();
  clearSearchCache();
});

describe("environment", () => {
  it("reads the same variables the clients read", () => {
    expect(supplierEnvironment("viator", { VIATOR_API_ENV: "production" })).toBe("production");
    expect(supplierEnvironment("viator", {})).toBe("sandbox");
    expect(supplierEnvironment("traveldesk", { TRAVELDESK_API_ENV: "production" })).toBe("production");
    expect(supplierEnvironment("yatra", {})).toBeNull();
  });
});

describe("switches", () => {
  it("lists only the switched-off suppliers, and falls back to none when the table cannot be read", async () => {
    const db = { supplierSetting: { findMany: async () => [{ supplierId: "viator" }] } } as unknown as Pick<PrismaClient, "supplierSetting">;
    expect([...(await disabledSuppliers(db))]).toEqual(["viator"]);
    clearSupplierSettingsCache();
    const broken = {
      supplierSetting: {
        findMany: async () => {
          throw new Error("no table");
        },
      },
    } as unknown as Pick<PrismaClient, "supplierSetting">;
    expect((await disabledSuppliers(broken)).size).toBe(0);
  });

  it("only known suppliers can be switched, and the change clears the cache", async () => {
    const upsert = vi.fn(async () => ({}));
    const db = { supplierSetting: { upsert } } as unknown as Pick<PrismaClient, "supplierSetting">;
    await setSupplierEnabled("viator", false, db, [adapter("viator")]);
    expect(upsert).toHaveBeenCalledWith({ where: { supplierId: "viator" }, create: { supplierId: "viator", enabled: false }, update: { enabled: false } });
    await expect(setSupplierEnabled("made-up", false, db, [adapter("viator")])).rejects.toBeInstanceOf(SupplierAdminError);
  });
});

describe("call log", () => {
  it("stores generic text only, and nothing for a successful call", () => {
    const create = vi.fn((_args: unknown) => Promise.resolve({}));
    const db = { supplierCall: { create, deleteMany: vi.fn() } } as unknown as Pick<PrismaClient, "supplierCall">;
    recordCall({ supplier: "viator", status: "ERROR", itemCount: 0, latencyMs: 250, message: "Viator returned an error." }, "activity", db);
    recordCall({ supplier: "viator", status: "OK", itemCount: 5, latencyMs: 120, message: "note text" }, "activity", db);
    const data = create.mock.calls.map((c) => (c[0] as { data: Record<string, unknown> }).data);
    expect(data[0]).toMatchObject({ status: "ERROR", message: "Viator returned an error." });
    expect(data[1]).toMatchObject({ status: "OK", message: null });
  });

  it("never throws when the database is down", () => {
    const db = { supplierCall: { create: () => Promise.reject(new Error("down")) } } as unknown as Pick<PrismaClient, "supplierCall">;
    expect(() => recordCall({ supplier: "a", status: "OK", itemCount: 0, latencyMs: 1 }, "activity", db)).not.toThrow();
  });
});

describe("admin listing", () => {
  it("combines configuration, switch, environment and 30-day health per supplier", async () => {
    const db = {
      supplierSetting: { findMany: async () => [{ supplierId: "off", enabled: false }] },
      supplierCall: {
        groupBy: async (args: { by: string[] }) =>
          args.by.length === 2
            ? [
                { supplier: "viator", status: "OK", _count: { _all: 8 }, _avg: { latencyMs: 300 } },
                { supplier: "viator", status: "TIMEOUT", _count: { _all: 2 }, _avg: { latencyMs: 8000 } },
              ]
            : [{ supplier: "viator", _max: { createdAt: new Date("2026-11-22T10:00:00Z") } }],
        findMany: async () => [{ supplier: "viator", status: "TIMEOUT", message: "Viator did not answer within 8s.", createdAt: new Date("2026-11-22T09:00:00Z") }],
      },
    } as unknown as Pick<PrismaClient, "supplierSetting" | "supplierCall">;
    const rows = await listSupplierAdmin(db, [adapter("viator"), adapter("off"), adapter("yatra", { isConfigured: () => false })], 30, { VIATOR_API_ENV: "production" });
    const v = rows.find((r) => r.id === "viator");
    expect(v).toMatchObject({ configured: true, enabled: true, environment: "production" });
    expect(v?.stats).toMatchObject({ calls: 10, ok: 8, timeouts: 2, errors: 0, avgLatencyMs: 1840 });
    expect(v?.stats.lastProblem?.message).toContain("did not answer");
    expect(rows.find((r) => r.id === "off")?.enabled).toBe(false);
    expect(rows.find((r) => r.id === "yatra")).toMatchObject({ configured: false, reason: "needs a key", environment: null });
  });
});

describe("test connection", () => {
  it("makes one real search against the named supplier only and returns a compact result", async () => {
    const search = vi.fn(async () => ({ items: [], environment: "sandbox" }));
    const other = vi.fn(async () => ({ items: [], environment: "sandbox" }));
    const r = await testSupplier("a", [adapter("a", { search }), adapter("b", { search: other })]);
    expect(search).toHaveBeenCalledTimes(1);
    expect(other).not.toHaveBeenCalled();
    expect(r).toMatchObject({ supplier: "a", status: "OK", environment: "sandbox" });
    await expect(testSupplier("nope", [adapter("a")])).rejects.toBeInstanceOf(SupplierAdminError);
  });

  it("reports an unconfigured supplier honestly instead of calling it", async () => {
    const search = vi.fn();
    const r = await testSupplier("a", [adapter("a", { isConfigured: () => false, search })]);
    expect(r.status).toBe("NOT_CONFIGURED");
    expect(search).not.toHaveBeenCalled();
  });
});
