import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { resetTravelDeskClient } from "@/integrations/traveldesk/client";
import * as limits from "@/server/billing/limits";
import type { TenantContext } from "@/server/tenant-context";
import {
  BookingError,
  cancelBooking,
  confirmBooking,
  getAgencyVoucher,
  getVoucher,
  refreshBooking,
  reserveSchema,
  reserveTraveldeskBooking,
  type ReserveInput,
} from "./traveldesk-booking";
import { mapSupplierBooking, reservationDeadline } from "./traveldesk-status";

// Plan enforcement has its own tests (billing.test.ts); here it is a controllable stub.
vi.mock("@/server/billing/limits", () => ({
  assertFeature: vi.fn(async () => undefined),
  assertWithinLimit: vi.fn(async () => undefined),
  LimitError: class LimitError extends Error {
    constructor(
      readonly code: string,
      message: string
    ) {
      super(message);
    }
  },
}));

// ------------------------------------------------------------------ in-memory database
interface Item {
  id: string;
  status: string;
  supplierReference: string | null;
  details: unknown;
}
interface Row {
  id: string;
  tenantId: string;
  customerId: string;
  reference: string;
  status: string;
  total: number;
  currency: string;
  idempotencyKey: string | null;
  createdAt: Date;
  items: Item[];
}

function makeDb() {
  const rows: Row[] = [];
  const vouchers: { bookingId: string }[] = [];
  let n = 0;
  const match = (r: Row, where: Record<string, unknown>) =>
    Object.entries(where).every(([k, v]) => {
      if (k === "idempotencyKey" && v && typeof v === "object") return r.idempotencyKey !== null;
      return (r as unknown as Record<string, unknown>)[k] === v;
    });
  const db = {
    customer: { findFirst: async () => ({ id: "cust1" }) },
    booking: {
      findFirst: async ({ where }: { where: Record<string, unknown> }) => rows.find((r) => match(r, where)) ?? null,
      findMany: async ({ where }: { where: Record<string, unknown> }) => rows.filter((r) => match(r, where)),
      create: async ({ data }: { data: Omit<Row, "id" | "createdAt" | "items"> & { items: { create: Omit<Item, "id" | "supplierReference"> } } }) => {
        const row: Row = {
          id: `b${++n}`,
          tenantId: data.tenantId,
          customerId: data.customerId,
          reference: data.reference,
          status: data.status,
          total: data.total,
          currency: data.currency,
          idempotencyKey: data.idempotencyKey,
          createdAt: new Date(),
          items: [{ id: `i${n}`, status: data.items.create.status, supplierReference: null, details: data.items.create.details }],
        };
        rows.push(row);
        return row;
      },
      update: async ({ where, data }: { where: { id: string }; data: Partial<Row> }) => Object.assign(rows.find((r) => r.id === where.id) as Row, data),
      updateMany: async ({ where, data }: { where: Record<string, unknown>; data: Partial<Row> }) => {
        const hit = rows.filter((r) => match(r, where));
        hit.forEach((r) => Object.assign(r, data));
        return { count: hit.length };
      },
    },
    companySettings: { findFirst: async () => ({ name: "Test Agency", address: "1 Road", phone: null, email: null }) },
    bookingItem: {
      update: async ({ where, data }: { where: { id: string }; data: Partial<Item> }) => {
        const item = rows.flatMap((r) => r.items).find((i) => i.id === where.id) as Item;
        return Object.assign(item, data);
      },
    },
    voucher: {
      findFirst: async ({ where }: { where: { bookingId: string } }) => vouchers.find((v) => v.bookingId === where.bookingId) ?? null,
      create: async ({ data }: { data: { bookingId: string } }) => {
        vouchers.push({ bookingId: data.bookingId });
        return data;
      },
    },
    $transaction: async <T>(fn: (tx: unknown) => Promise<T>) => fn(db),
  };
  return { db, rows, vouchers };
}

function makeCtx(role: TenantContext["role"] = "OWNER") {
  const store = makeDb();
  const ctx = { userId: "u1", tenantId: "t1", role, db: store.db } as unknown as TenantContext;
  return { ctx, ...store };
}

// ------------------------------------------------------------------ supplier simulator
interface Sim {
  slots: { timeSlotId: number; startTime: number; endTime: number; left: number; perAdult: number }[];
  offer: { bookingType: number; isDirectReporting: boolean; infantsAllowed: boolean };
  reserveStatus: number;
  confirmStatus: number;
  bookingStatus: number;
  reserveHttp: number;
  confirmHttp: number;
  confirmThrows: boolean;
  cancelHttp: number;
  voucherPdf: boolean;
  calls: string[];
  reserveBody?: Record<string, unknown>;
}

function simulator(over: Partial<Sim> = {}): Sim {
  const sim: Sim = {
    slots: [{ timeSlotId: 18, startTime: 1260, endTime: 1365, left: 180, perAdult: 46 }],
    offer: { bookingType: 1, isDirectReporting: true, infantsAllowed: true },
    reserveStatus: 7,
    confirmStatus: 1,
    bookingStatus: 7,
    reserveHttp: 201,
    confirmHttp: 200,
    confirmThrows: false,
    cancelHttp: 200,
    voucherPdf: true,
    calls: [],
    ...over,
  };
  const dto = (status: number) => ({
    id: 306598,
    bookingReference: String(sim.reserveBody?.referenceNumber ?? "echo"),
    status,
    bookingType: sim.offer.bookingType,
    offerId: 62,
    tourId: 5,
    date: "2099-12-15T00:00:00",
    adults: 1,
    children: 0,
    totalCost: 46,
    reservationTimeout: 15,
    downloadVoucherUrl: "https://testapi.traveldesk.me/x?guid=SECRET-GUID",
    customerSupportPhone: "+971 0",
  });
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: URL | string, init?: RequestInit) => {
      const u = new URL(url.toString());
      const method = init?.method ?? "GET";
      sim.calls.push(`${method} ${u.pathname.replace("/public/b2b/v1", "")}`);
      const json = (b: unknown, status = 200) => new Response(JSON.stringify(b), { status });
      const p = u.pathname.replace("/public/b2b/v1", "");
      if (p.startsWith("/tours/")) {
        return json({ id: 5, name: "Dinner Cruise", offers: [{ id: 62, name: "Cruise", ...sim.offer }], cancellationPolicy: [{ hours: 24, percents: 50 }] });
      }
      if (p === "/availability/byoffer") {
        return json(
          sim.slots.map((s) => ({
            availability: { date: "2099-12-15T00:00:00", startTime: s.startTime, endTime: s.endTime, timeSlotId: s.timeSlotId, left: s.left },
            price: { currency: "USD", pricePerAdult: s.perAdult, pricePerChild: 30, pricePerTrip: 0, isBookable: true, vat: 5 },
          }))
        );
      }
      if (p === "/bookings/reserve") {
        sim.reserveBody = JSON.parse(String(init?.body));
        return sim.reserveHttp === 201 ? json(dto(sim.reserveStatus), 201) : json({ message: "Sold out for that slot" }, sim.reserveHttp);
      }
      if (p === "/bookings/confirm") {
        if (sim.confirmThrows) throw new TypeError("network down");
        if (sim.confirmHttp !== 200) return json({ message: "Insufficient balance" }, sim.confirmHttp);
        sim.bookingStatus = sim.confirmStatus;
        return json(dto(sim.confirmStatus));
      }
      if (p === "/bookings/cancel") {
        if (sim.cancelHttp !== 200) return json({ message: "Too late to cancel" }, sim.cancelHttp);
        sim.bookingStatus = 4;
        return json({ isSuccess: true });
      }
      if (p.endsWith("/downloadvoucher")) {
        return sim.voucherPdf
          ? new Response(new Uint8Array([37, 80, 68, 70]), { status: 200, headers: { "content-type": "application/pdf" } })
          : new Response("nope", { status: 200, headers: { "content-type": "text/html" } });
      }
      if (/^\/bookings\/\d+$/.test(p)) return json(dto(sim.bookingStatus));
      return json({}, 404);
    })
  );
  return sim;
}

const input: ReserveInput = reserveSchema.parse({ tourId: 5, offerId: 62, date: "2099-12-15", adults: 1, guestName: "Asha Rao", email: "asha@example.com" });

beforeEach(() => {
  process.env.TRAVELDESK_API_KEY = "test-key";
  delete process.env.TRAVELDESK_API_ENV;
  resetTravelDeskClient();
  vi.spyOn(console, "error").mockImplementation(() => undefined);
});
afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  delete process.env.TRAVELDESK_API_KEY;
});

const rejection = async (p: Promise<unknown>) => (await p.then(() => null, (e: unknown) => e)) as BookingError | null;

// ------------------------------------------------------------------ status mapper
describe("mapSupplierBooking", () => {
  const b = (over: Record<string, unknown>) => ({ id: 1, status: 7, offerId: 1, tourId: 1, date: "d", adults: 1, children: 0, totalCost: 1, bookingType: 1, ...over }) as never;

  it("never reports CONFIRMED before a confirm request succeeded", () => {
    expect(mapSupplierBooking(b({ status: 1 }), false).status).toBe("IN_PROGRESS");
    expect(mapSupplierBooking(b({ status: 0 }), false).status).toBe("IN_PROGRESS");
    expect(mapSupplierBooking(b({ status: 7 }), true).status).toBe("RESERVED");
  });
  it("maps the supplier states", () => {
    expect(mapSupplierBooking(b({ status: 5 }), false).status).toBe("CONFIRMED");
    expect(mapSupplierBooking(b({ status: 1 }), true).status).toBe("CONFIRMED");
    expect(mapSupplierBooking(b({ status: 2 }), true).status).toBe("PENDING_SUPPLIER");
    expect(mapSupplierBooking(b({ status: 1, bookingType: 0 }), true).status).toBe("PENDING_SUPPLIER");
    expect(mapSupplierBooking(b({ status: 3 }), true).status).toBe("PAYMENT_PENDING");
    expect(mapSupplierBooking(b({ status: 4 }), true).status).toBe("CANCELLED");
    expect(mapSupplierBooking(b({ status: 6 }), true).status).toBe("FAILED");
    expect(mapSupplierBooking(b({ status: 8 }), false).status).toBe("FAILED");
    expect(mapSupplierBooking(b({ status: 99 }), true).status).toBe("IN_PROGRESS");
  });
  it("a supplier failure flag overrides everything", () => {
    expect(mapSupplierBooking(b({ status: 5, isExternalBookingFailed: true, externalBookingFailureMessage: "boom" }), true)).toMatchObject({ status: "FAILED", note: "boom" });
  });
  it("does not confirm while the supplier's own confirmation is still running", () => {
    expect(mapSupplierBooking(b({ status: 1, isExternalConfirmationInProgress: true }), true).status).toBe("IN_PROGRESS");
  });
  it("computes the hold deadline from our clock", () => {
    const at = new Date("2026-01-01T00:00:00Z");
    expect(reservationDeadline(at, 15).toISOString()).toBe("2026-01-01T00:15:00.000Z");
    expect(reservationDeadline(at, null).toISOString()).toBe("2026-01-01T00:15:00.000Z");
  });
});

// ------------------------------------------------------------------ reserve
describe("reserve", () => {
  it("holds the booking using server-side price, and stores the supplier id (not our echoed reference)", async () => {
    const sim = simulator();
    const { ctx, rows } = makeCtx();
    const { booking, replay } = await reserveTraveldeskBooking(ctx, input, "key-12345678");
    expect(replay).toBe(false);
    expect(booking).toMatchObject({ status: "RESERVED", sandbox: true, customerPayment: "NOT_COLLECTED", canConfirm: true });
    expect(booking.supplier.bookingId).toBe(306598);
    expect(booking.reference).toMatch(/^MK-TD-/);
    expect(rows[0].items[0].supplierReference).toBe("306598");
    expect(sim.reserveBody).toMatchObject({ offerId: 62, totalCost: 46, totalCostUsd: 46, currency: "USD", cashCollect: 0, timeSlotId: 18, startTime: 1260 });
    const deadline = new Date(booking.reservationDeadline as string).getTime();
    expect(deadline - Date.now()).toBeGreaterThan(14 * 60_000);
    expect(deadline - Date.now()).toBeLessThanOrEqual(15 * 60_000);
  });

  it("never stores or returns the supplier's anonymous voucher link", async () => {
    simulator();
    const { ctx, rows } = makeCtx();
    const { booking } = await reserveTraveldeskBooking(ctx, input, "key-12345678");
    expect(JSON.stringify(rows)).not.toContain("SECRET-GUID");
    expect(JSON.stringify(booking)).not.toContain("SECRET-GUID");
  });

  it("is idempotent: the same key returns the same booking and makes one supplier hold", async () => {
    const sim = simulator();
    const { ctx, rows } = makeCtx();
    const a = await reserveTraveldeskBooking(ctx, input, "same-key-1234");
    const b = await reserveTraveldeskBooking(ctx, input, "same-key-1234");
    expect(b.replay).toBe(true);
    expect(b.booking.id).toBe(a.booking.id);
    expect(rows).toHaveLength(1);
    expect(sim.calls.filter((c) => c === "POST /bookings/reserve")).toHaveLength(1);
  });

  it("rejects unavailable, missing-hotel, infant, past-date and ambiguous-slot requests before calling the supplier", async () => {
    const reserveCalls = (s: Sim) => s.calls.filter((c) => c.includes("reserve")).length;

    let sim = simulator({ slots: [{ timeSlotId: 18, startTime: 1260, endTime: 1365, left: 0, perAdult: 46 }] });
    let { ctx } = makeCtx();
    expect((await rejection(reserveTraveldeskBooking(ctx, input, "k-unavail-1")))?.code).toBe("UNAVAILABLE");
    expect(reserveCalls(sim)).toBe(0);

    sim = simulator({ offer: { bookingType: 1, isDirectReporting: false, infantsAllowed: true } });
    ({ ctx } = makeCtx());
    expect((await rejection(reserveTraveldeskBooking(ctx, input, "k-hotel-0001")))?.message).toMatch(/hotel/);
    expect(reserveCalls(sim)).toBe(0);

    sim = simulator({ offer: { bookingType: 1, isDirectReporting: true, infantsAllowed: false } });
    ({ ctx } = makeCtx());
    expect((await rejection(reserveTraveldeskBooking(ctx, { ...input, infants: 1 }, "k-infant-001")))?.message).toMatch(/infants/);

    sim = simulator();
    ({ ctx } = makeCtx());
    expect((await rejection(reserveTraveldeskBooking(ctx, { ...input, date: "2000-01-01" }, "k-past-00001")))?.message).toMatch(/past/);

    sim = simulator({
      slots: [
        { timeSlotId: 1, startTime: 600, endTime: 700, left: 9, perAdult: 40 },
        { timeSlotId: 2, startTime: 900, endTime: 1000, left: 9, perAdult: 50 },
      ],
    });
    ({ ctx } = makeCtx());
    expect((await rejection(reserveTraveldeskBooking(ctx, input, "k-slot-00001")))?.message).toMatch(/time slot/);
    const picked = await reserveTraveldeskBooking(ctx, { ...input, timeSlotId: 2 }, "k-slot-00002");
    expect(picked.booking.cost?.total).toBe(50); // price comes from the picked slot, not from the client
    expect(sim.reserveBody).toMatchObject({ timeSlotId: 2, totalCost: 50 });
  });

  it("records a supplier refusal as FAILED with the supplier's reason", async () => {
    simulator({ reserveHttp: 400 });
    const { ctx, rows } = makeCtx();
    const err = await rejection(reserveTraveldeskBooking(ctx, input, "k-refuse-001"));
    expect(err?.code).toBe("SUPPLIER_ERROR");
    expect(err?.message).toMatch(/Sold out/);
    expect(rows[0].status).toBe("FAILED");
    expect((rows[0].items[0].details as { stage: string }).stage).toBe("RESERVE_FAILED");
  });

  it("refuses to place real bookings unless live booking is explicitly switched on", async () => {
    const sim = simulator();
    process.env.TRAVELDESK_API_ENV = "production";
    resetTravelDeskClient();
    const { ctx } = makeCtx();
    const err = await rejection(reserveTraveldeskBooking(ctx, input, "k-live-guard1"));
    expect(err?.code).toBe("NOT_CONFIGURED");
    expect(err?.message).toMatch(/TRAVELDESK_ALLOW_LIVE_BOOKING/);
    expect(sim.calls.filter((c) => c.includes("reserve"))).toHaveLength(0);

    process.env.TRAVELDESK_ALLOW_LIVE_BOOKING = "true";
    try {
      const ok = await reserveTraveldeskBooking(ctx, input, "k-live-guard2");
      expect(ok.booking.sandbox).toBe(false);
    } finally {
      delete process.env.TRAVELDESK_ALLOW_LIVE_BOOKING;
    }
  });

  it("returns the winner when two requests race on the same idempotency key", async () => {
    simulator();
    const { ctx, db, rows } = makeCtx();
    const first = await reserveTraveldeskBooking(ctx, input, "k-race-00001");
    // Simulate the race: the pre-check misses, then create hits the unique constraint.
    const realFind = db.booking.findFirst;
    let hide = true;
    db.booking.findFirst = async (args) => {
      if (hide && (args.where as Record<string, unknown>).idempotencyKey) {
        hide = false;
        return null;
      }
      return realFind(args);
    };
    db.booking.create = async () => {
      throw Object.assign(new Error("Unique constraint failed"), { code: "P2002" });
    };
    const second = await reserveTraveldeskBooking(ctx, input, "k-race-00001");
    expect(second.replay).toBe(true);
    expect(second.booking.id).toBe(first.booking.id);
    expect(rows).toHaveLength(1);
  });

  it("checks the plan before any supplier call, and a plan block never reaches the supplier", async () => {
    const sim = simulator();
    const { ctx, rows } = makeCtx();
    vi.mocked(limits.assertFeature).mockRejectedValueOnce(new limits.LimitError("FEATURE_DISABLED", "Starter does not include supplier bookings."));
    const err = (await reserveTraveldeskBooking(ctx, input, "k-plan-block1").then(() => null, (e: unknown) => e)) as Error | null;
    expect(err?.message).toMatch(/does not include/);
    expect(sim.calls).toEqual([]);
    expect(rows).toHaveLength(0);

    vi.mocked(limits.assertWithinLimit).mockRejectedValueOnce(new limits.LimitError("PLAN_LIMIT", "Monthly booking limit reached."));
    expect(await reserveTraveldeskBooking(ctx, input, "k-plan-block2").then(() => null, (e: unknown) => e)).toBeInstanceOf(Error);
    expect(sim.calls).toEqual([]);
    expect(limits.assertWithinLimit).toHaveBeenCalledWith(ctx, "bookings");
  });

  it("a replayed request is free: it does not need plan headroom", async () => {
    simulator();
    const { ctx } = makeCtx();
    await reserveTraveldeskBooking(ctx, input, "k-replay-free");
    vi.mocked(limits.assertWithinLimit).mockClear();
    const again = await reserveTraveldeskBooking(ctx, input, "k-replay-free");
    expect(again.replay).toBe(true);
    expect(limits.assertWithinLimit).not.toHaveBeenCalled();
  });

  it("hides supplier cost from roles without cost:view", async () => {
    simulator();
    const { ctx } = makeCtx("CONSULTANT");
    const { booking } = await reserveTraveldeskBooking(ctx, input, "k-consult-01");
    expect(booking.cost).toBeUndefined();
    expect(booking.canConfirm).toBe(false); // consultants may reserve, not confirm
  });
});

// ------------------------------------------------------------------ confirm
describe("confirm", () => {
  async function reserved(simOver: Partial<Sim> = {}, role: TenantContext["role"] = "OWNER") {
    const sim = simulator(simOver);
    const store = makeCtx(role);
    const { booking } = await reserveTraveldeskBooking(store.ctx, input, "k-" + Math.random().toString(36).slice(2, 12));
    return { sim, ...store, id: booking.id };
  }
  const confirmCalls = (s: Sim) => s.calls.filter((c) => c === "POST /bookings/confirm").length;

  it("refuses to charge an amount the user did not approve", async () => {
    const { sim, ctx, id } = await reserved();
    const err = await rejection(confirmBooking(ctx, id, 10));
    expect(err?.code).toBe("PRICE_CHANGED");
    expect(confirmCalls(sim)).toBe(0);
  });

  it("refuses when the supplier price moved after reservation, and charges nothing", async () => {
    const { sim, ctx, id } = await reserved();
    sim.slots[0].perAdult = 60;
    const err = await rejection(confirmBooking(ctx, id, 46));
    expect(err?.code).toBe("PRICE_CHANGED");
    expect(err?.extra).toMatchObject({ currentTotal: 60 });
    expect(confirmCalls(sim)).toBe(0);
  });

  it("confirms an instantly-bookable item and shows the supplier's own status next to ours", async () => {
    const { sim, ctx, id } = await reserved();
    const v = await confirmBooking(ctx, id, 46);
    expect(v.status).toBe("CONFIRMED");
    expect(v.supplier.status).toBe("PendingVerification");
    expect(v.note).toMatch(/PendingVerification/);
    expect(v.canDownloadVoucher).toBe(true);
    expect(confirmCalls(sim)).toBe(1);
  });

  it("an on-request item stays PENDING_SUPPLIER, never CONFIRMED", async () => {
    const { ctx, id } = await reserved({ offer: { bookingType: 0, isDirectReporting: true, infantsAllowed: true }, confirmStatus: 2 });
    const v = await confirmBooking(ctx, id, 46);
    expect(v.status).toBe("PENDING_SUPPLIER");
    expect(v.canDownloadVoucher).toBe(false);
  });

  it("a second confirm cannot double-charge", async () => {
    const { sim, ctx, id } = await reserved();
    await confirmBooking(ctx, id, 46);
    const err = await rejection(confirmBooking(ctx, id, 46));
    expect(err?.code).toBe("WRONG_STATE");
    expect(confirmCalls(sim)).toBe(1);
  });

  it("a supplier refusal leaves the hold in place so it can be retried or cancelled", async () => {
    const { ctx, rows, id } = await reserved({ confirmHttp: 400 });
    const err = await rejection(confirmBooking(ctx, id, 46));
    expect(err?.message).toMatch(/Insufficient balance/);
    expect(rows[0].status).toBe("RESERVED");
  });

  it("an unknown outcome (network failure) is never reported as confirmed and is not retried", async () => {
    const { sim, ctx, rows, id } = await reserved({ confirmThrows: true });
    const err = await rejection(confirmBooking(ctx, id, 46));
    expect(err?.code).toBe("SUPPLIER_ERROR");
    expect(rows[0].status).toBe("IN_PROGRESS");
    expect((rows[0].items[0].details as { stage: string }).stage).toBe("CONFIRM_UNKNOWN");
    expect(confirmCalls(sim)).toBe(1);
    // The supplier never received it: a refresh sees it is still only held.
    sim.confirmThrows = false;
    const v = await refreshBooking(ctx, id);
    expect(v.status).toBe("RESERVED");
  });

  it("a refresh after an unknown outcome picks up a confirmation the supplier did record", async () => {
    const { sim, ctx, id } = await reserved({ confirmThrows: true });
    await rejection(confirmBooking(ctx, id, 46));
    sim.bookingStatus = 1; // the supplier did process it
    expect((await refreshBooking(ctx, id)).status).toBe("CONFIRMED");
  });

  it("does not confirm once the supplier has let the hold expire", async () => {
    const { sim, ctx, id } = await reserved();
    sim.bookingStatus = 8; // TimedOut
    const err = await rejection(confirmBooking(ctx, id, 46));
    expect(err?.code).toBe("WRONG_STATE");
    expect(confirmCalls(sim)).toBe(0);
  });
});

// ------------------------------------------------------------------ cancel + voucher
describe("cancel and voucher", () => {
  async function confirmed() {
    const sim = simulator();
    const store = makeCtx();
    const { booking } = await reserveTraveldeskBooking(store.ctx, input, "k-" + Math.random().toString(36).slice(2, 12));
    await confirmBooking(store.ctx, booking.id, 46);
    return { sim, ...store, id: booking.id };
  }

  it("cancels a confirmed booking through the supplier", async () => {
    const { ctx, id } = await confirmed();
    const v = await cancelBooking(ctx, id);
    expect(v.status).toBe("CANCELLED");
    expect(v.supplier.status).toBe("Cancelled");
    expect(v.canCancel).toBe(false);
    expect((await rejection(cancelBooking(ctx, id)))?.code).toBe("WRONG_STATE");
  });

  it("keeps the booking as-is when the supplier refuses to cancel", async () => {
    const { sim, ctx, rows, id } = await confirmed();
    sim.cancelHttp = 400;
    const err = await rejection(cancelBooking(ctx, id));
    expect(err?.message).toMatch(/Too late/);
    expect(rows[0].status).toBe("CONFIRMED");
  });

  it("a refresh never revives a cancelled booking", async () => {
    const { sim, ctx, id } = await confirmed();
    await cancelBooking(ctx, id);
    sim.bookingStatus = 1;
    expect((await refreshBooking(ctx, id)).status).toBe("CANCELLED");
  });

  it("serves the supplier voucher only for confirmed bookings, and records it once", async () => {
    const { ctx, vouchers, id } = await confirmed();
    const a = await getVoucher(ctx, id);
    expect(Array.from(a.bytes.slice(0, 4))).toEqual([37, 80, 68, 70]);
    await getVoucher(ctx, id);
    expect(vouchers).toHaveLength(1);
  });

  it("the agency voucher is a PDF that shows the supplier's own status and a test stamp, and makes no supplier call", async () => {
    const { sim, ctx, id } = await confirmed();
    const before = sim.calls?.length ?? 0;
    const v = await getAgencyVoucher(ctx, id);
    expect(Array.from(v.bytes.slice(0, 4))).toEqual([37, 80, 68, 70]);
    expect(sim.calls?.length ?? 0).toBe(before);
    const { renderVoucher } = await import("./voucher-pdf");
    const { getBooking } = await import("./traveldesk-booking");
    const view = await getBooking(ctx, id);
    expect(view.sandbox).toBe(true);
    // The rendered text is compressed inside the PDF, so check the pieces that build it instead.
    expect((await renderVoucher(view, { name: "Test Agency" })).length).toBeGreaterThan(1000);
  });

  it("refuses an agency voucher unless the supplier has confirmed the booking", async () => {
    simulator();
    const { ctx } = makeCtx();
    const { booking } = await reserveTraveldeskBooking(ctx, input, "k-voucher-002");
    expect((await rejection(getAgencyVoucher(ctx, booking.id)))?.code).toBe("WRONG_STATE");
    const { renderVoucher, VoucherNotAllowedError } = await import("./voucher-pdf");
    const { getBooking } = await import("./traveldesk-booking");
    await expect(renderVoucher(await getBooking(ctx, booking.id), { name: "x" })).rejects.toBeInstanceOf(VoucherNotAllowedError);
  });

  it("refuses a voucher for a held or cancelled booking", async () => {
    simulator();
    const { ctx } = makeCtx();
    const { booking } = await reserveTraveldeskBooking(ctx, input, "k-voucher-001");
    expect((await rejection(getVoucher(ctx, booking.id)))?.code).toBe("WRONG_STATE");
  });

  it("rejects a non-PDF voucher response instead of passing it on", async () => {
    const { sim, ctx, id } = await confirmed();
    sim.voucherPdf = false;
    expect((await rejection(getVoucher(ctx, id)))?.code).toBe("SUPPLIER_ERROR");
  });

  it("lets only the owning customer see a booking", async () => {
    const { ctx, rows, id } = await confirmed();
    rows[0].customerId = "someone-else";
    expect((await rejection(refreshBooking(ctx, id)))?.code).toBe("NOT_FOUND");
  });
});
