import { NextRequest } from "next/server";
import { describe, expect, it } from "vitest";
import { crossOriginResponse } from "./same-origin";

const req = (origin?: string) =>
  new NextRequest("https://app.example.com/api/bookings/x/confirm", { method: "POST", headers: origin ? { origin } : {} });

describe("crossOriginResponse", () => {
  it("allows the same site and requests with no Origin header", () => {
    expect(crossOriginResponse(req("https://app.example.com"))).toBeNull();
    expect(crossOriginResponse(req())).toBeNull();
  });

  it("blocks other sites and malformed origins", async () => {
    const other = crossOriginResponse(req("https://evil.example"));
    expect(other?.status).toBe(403);
    expect(crossOriginResponse(req("not a url"))?.status).toBe(403);
    // A look-alike host must not pass a prefix or suffix match.
    expect(crossOriginResponse(req("https://app.example.com.evil.example"))?.status).toBe(403);
  });
});
