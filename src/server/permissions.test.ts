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

  it("missing role is denied", () => {
    expect(can(undefined, "chat:use")).toBe(false);
    expect(() => assertCan(null, "chat:use")).toThrow(ForbiddenError);
  });
});
