import { describe, expect, it } from "vitest";
import { isSchemaMismatch } from "./db-schema";

describe("isSchemaMismatch", () => {
  it("recognises Prisma missing-table and missing-column errors", () => {
    expect(isSchemaMismatch(Object.assign(new Error("x"), { code: "P2021" }))).toBe(true);
    expect(isSchemaMismatch(Object.assign(new Error("x"), { code: "P2022" }))).toBe(true);
  });
  it("ignores everything else", () => {
    expect(isSchemaMismatch(Object.assign(new Error("x"), { code: "P2002" }))).toBe(false);
    expect(isSchemaMismatch(new Error("boom"))).toBe(false);
    expect(isSchemaMismatch(null)).toBe(false);
    expect(isSchemaMismatch("P2022")).toBe(false);
  });
});
