import { describe, expect, it } from "vitest";
import { assertCan, can, ForbiddenError } from "./permissions";

describe("permissions", () => {
  it("owner can manage suppliers; readonly cannot chat", () => {
    expect(can("OWNER", "supplier:manage")).toBe(true);
    expect(can("READONLY", "chat:use")).toBe(false);
  });

  it("only cost-authorised roles can see internal cost", () => {
    expect(can("ACCOUNTS", "cost:view")).toBe(true);
    expect(can("CONSULTANT", "cost:view")).toBe(false);
    expect(can("SALES", "cost:view")).toBe(false);
  });

  it("only owner, admin and manager can confirm or cancel supplier bookings", () => {
    for (const r of ["OWNER", "ADMIN", "MANAGER"] as const) expect(can(r, "booking:manage")).toBe(true);
    for (const r of ["CONSULTANT", "SALES", "ACCOUNTS", "READONLY"] as const) expect(can(r, "booking:manage")).toBe(false);
    // Consultants can still reserve (a short, free hold).
    expect(can("CONSULTANT", "booking:create")).toBe(true);
  });

  it("missing role is denied", () => {
    expect(can(undefined, "chat:use")).toBe(false);
    expect(() => assertCan(null, "chat:use")).toThrow(ForbiddenError);
  });
});
