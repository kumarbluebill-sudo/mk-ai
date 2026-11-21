import { describe, expect, it } from "vitest";
import { applyTenantScope, TENANT_MODELS } from "./tenant-scope";

const T = "tenant_a";

describe("applyTenantScope", () => {
  it("adds tenantId to reads and overrides a caller-supplied tenantId", () => {
    expect(applyTenantScope("findMany", { where: { title: "x" } }, T).where).toEqual({ title: "x", tenantId: T });
    expect(applyTenantScope("findMany", { where: { tenantId: "tenant_b" } }, T).where).toEqual({ tenantId: T });
    expect(applyTenantScope("findMany", undefined, T).where).toEqual({ tenantId: T });
  });

  it("scopes unique lookups, updates and deletes", () => {
    for (const op of ["findUnique", "update", "delete", "updateMany", "deleteMany", "count"]) {
      expect(applyTenantScope(op, { where: { id: "1" } }, T).where).toEqual({ id: "1", tenantId: T });
    }
  });

  it("stamps tenantId on create and createMany", () => {
    expect(applyTenantScope("create", { data: { title: "t" } }, T).data).toEqual({ title: "t", tenantId: T });
    expect(applyTenantScope("createMany", { data: [{ a: 1 }, { a: 2 }] }, T).data).toEqual([
      { a: 1, tenantId: T },
      { a: 2, tenantId: T },
    ]);
  });

  it("prevents moving a row to another tenant via update", () => {
    const out = applyTenantScope("update", { where: { id: "1" }, data: { tenantId: "tenant_b", title: "n" } }, T);
    expect(out.data).toEqual({ tenantId: T, title: "n" });
  });

  it("scopes all branches of upsert", () => {
    const out = applyTenantScope("upsert", { where: { id: "1" }, create: { a: 1 }, update: { a: 2 } }, T);
    expect(out.where).toEqual({ id: "1", tenantId: T });
    expect(out.create).toEqual({ a: 1, tenantId: T });
    expect(out.update).toEqual({ a: 2, tenantId: T });
  });

  it("covers the core tenant-owned models", () => {
    for (const m of ["Customer", "Conversation", "Itinerary", "Quotation", "Booking", "Payment", "SupplierCredential"]) {
      expect(TENANT_MODELS.has(m)).toBe(true);
    }
  });
});
