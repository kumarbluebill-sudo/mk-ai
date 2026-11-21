import { z } from "zod";
import type { Prisma } from "@/generated/prisma/client";
import { getTravelDeskClient, TravelDeskError, type TravelDeskClient } from "@/integrations/traveldesk/client";
import { recordAudit } from "@/server/audit";
import { assertFeature, assertWithinLimit } from "@/server/billing/limits";
import { can } from "@/server/permissions";
import { checkTravelDeskAvailability, type SlotResult } from "@/server/suppliers/traveldesk-availability";
import type { TenantContext } from "@/server/tenant-context";
import { mapSupplierBooking, reservationDeadline, sameAmount, supplierStatusName, type LocalBookingStatus, type Stage } from "./traveldesk-status";

/**
 * Traveldesk booking flow: reserve (short free hold) -> confirm (supplier charges the agency
 * balance) -> voucher, plus cancel and refresh.
 *
 * Honesty rules enforced here:
 *  - price, availability and slot are re-checked on the server; the client's numbers are never trusted;
 *  - a booking becomes CONFIRMED only through mapSupplierBooking(), i.e. from a supplier response;
 *  - the supplier's identifier is its numeric booking id (its "bookingReference" just echoes our reference);
 *  - customer payment is NOT collected by this app yet, and every view says so;
 *  - test-environment bookings are always labelled SANDBOX.
 */

export class BookingError extends Error {
  constructor(
    readonly code:
      | "NOT_CONFIGURED"
      | "NO_CUSTOMER"
      | "INVALID"
      | "UNAVAILABLE"
      | "PRICE_CHANGED"
      | "NOT_FOUND"
      | "WRONG_STATE"
      | "SUPPLIER_ERROR"
      | "CORRUPT",
    message: string,
    readonly extra?: Record<string, unknown>
  ) {
    super(message);
    this.name = "BookingError";
  }
}

const todayUtc = () => new Date().toISOString().slice(0, 10);

export const reserveSchema = z.object({
  tourId: z.number().int().positive(),
  offerId: z.number().int().positive(),
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  timeSlotId: z.number().int().optional(),
  startMinutes: z.number().int().min(0).max(1440).optional(),
  adults: z.number().int().min(1).max(15),
  children: z.number().int().min(0).max(14).default(0),
  infants: z.number().int().min(0).max(5).default(0),
  guestName: z.string().trim().min(1).max(120),
  email: z.string().trim().email().max(200).optional(),
  phone: z.string().trim().min(5).max(30).optional(),
  hotelId: z.number().int().positive().optional(),
  pickUpLocation: z.string().trim().max(200).optional(),
  remarks: z.string().trim().max(500).optional(),
});
export type ReserveInput = z.infer<typeof reserveSchema>;

export const confirmSchema = z.object({
  /** The supplier cost the user saw and agreed to charge. Must match what the supplier still quotes. */
  expectedTotal: z.number().positive(),
});

const detailsSchema = z
  .object({
    supplier: z.literal("traveldesk"),
    environment: z.string(),
    stage: z.string(),
    confirmRequested: z.boolean(),
    supplierBookingId: z.number().nullable(),
    supplierStatus: z.number().nullable(),
    supplierStatusName: z.string().nullable(),
    bookingType: z.number().nullable(),
    tour: z.object({ id: z.number(), name: z.string() }),
    offer: z.object({ id: z.number(), name: z.string() }),
    date: z.string(),
    slot: z
      .object({
        timeSlotId: z.number().nullable(),
        startMinutes: z.number().nullable(),
        endMinutes: z.number().nullable(),
        startTime: z.string().nullable(),
        endTime: z.string().nullable(),
      })
      .nullable(),
    pax: z.object({ adults: z.number(), children: z.number(), infants: z.number() }),
    guest: z.object({ name: z.string(), email: z.string().optional(), phone: z.string().optional() }),
    hotelId: z.number().optional(),
    pickUpLocation: z.string().optional(),
    remarks: z.string().optional(),
    cost: z.object({ currency: z.string(), total: z.number() }),
    reservedAt: z.string().nullable(),
    reservationDeadline: z.string().nullable(),
    cancellationPolicyRaw: z.array(z.object({ hours: z.number(), percents: z.number() })),
    customerSupportPhone: z.string().nullable(),
    note: z.string(),
    customerPayment: z.literal("NOT_COLLECTED"),
    ourReference: z.string(),
    events: z.array(z.object({ at: z.string(), type: z.string(), note: z.string() })),
  })
  .passthrough();
type Details = z.infer<typeof detailsSchema>;

type BookingRow = NonNullable<Awaited<ReturnType<typeof loadOwn>>>;

function readDetails(row: BookingRow): { item: BookingRow["items"][number]; details: Details } {
  const item = row.items[0];
  const parsed = item ? detailsSchema.safeParse(item.details) : null;
  if (!item || !parsed?.success) throw new BookingError("CORRUPT", "This booking record is not a Traveldesk booking or is damaged.");
  return { item, details: parsed.data };
}

async function ownCustomer(ctx: TenantContext) {
  return ctx.db.customer.findFirst({ where: { userId: ctx.userId }, select: { id: true } });
}

async function loadOwn(ctx: TenantContext, id: string) {
  const customer = await ownCustomer(ctx);
  if (!customer) return null;
  return ctx.db.booking.findFirst({ where: { id, customerId: customer.id }, include: { items: true } });
}

async function requireOwn(ctx: TenantContext, id: string): Promise<BookingRow> {
  const row = await loadOwn(ctx, id);
  if (!row) throw new BookingError("NOT_FOUND", "Booking not found");
  return row;
}

/**
 * Real money guard. A production Traveldesk key alone is not enough to place bookings: the operator
 * must also set TRAVELDESK_ALLOW_LIVE_BOOKING=true, because confirming charges the agency balance
 * and this app does not collect payment from the customer yet.
 */
function assertBookingAllowed(client: TravelDeskClient): void {
  if (client.environment === "production" && process.env.TRAVELDESK_ALLOW_LIVE_BOOKING !== "true") {
    throw new BookingError("NOT_CONFIGURED", "Live bookings are switched off. Set TRAVELDESK_ALLOW_LIVE_BOOKING=true to allow them.");
  }
}

function getClient(): TravelDeskClient {
  try {
    return getTravelDeskClient();
  } catch {
    throw new BookingError("NOT_CONFIGURED", "Traveldesk is not configured.");
  }
}

function event(details: Details, type: string, note: string): Details["events"] {
  return [...details.events, { at: new Date().toISOString(), type, note }].slice(-50);
}

async function persist(
  ctx: TenantContext,
  row: BookingRow,
  status: LocalBookingStatus | "DRAFT",
  details: Details,
  extra: { total?: number } = {}
) {
  const item = row.items[0];
  const json = details as unknown as Prisma.InputJsonValue;
  await ctx.db.$transaction(async (tx) => {
    await tx.booking.update({ where: { id: row.id }, data: { status, ...(extra.total !== undefined && { total: extra.total }) } });
    await tx.bookingItem.update({
      where: { id: item.id },
      data: { status, details: json, supplierReference: details.supplierBookingId !== null ? String(details.supplierBookingId) : null },
    });
  });
}

// ---------------------------------------------------------------------------------------------
// View
// ---------------------------------------------------------------------------------------------

export interface BookingView {
  id: string;
  reference: string;
  status: string;
  stage: string;
  environment: string;
  /** Always true while the test API is in use. */
  sandbox: boolean;
  note: string;
  tour: { id: number; name: string };
  offer: { id: number; name: string };
  date: string;
  slot: { startTime: string | null; endTime: string | null } | null;
  pax: { adults: number; children: number; infants: number };
  guest: { name: string; email?: string; phone?: string };
  supplier: { name: "Traveldesk"; bookingId: number | null; status: string | null; bookingType: number | null };
  reservationDeadline: string | null;
  /** Supplier net cost. Only for roles that may see cost. */
  cost?: { currency: string; total: number };
  cancellationPolicyRaw: { hours: number; percents: number }[];
  customerSupportPhone: string | null;
  customerPayment: "NOT_COLLECTED";
  canConfirm: boolean;
  canCancel: boolean;
  canDownloadVoucher: boolean;
  createdAt: string;
  events: Details["events"];
}

export function toView(ctx: TenantContext, row: BookingRow): BookingView {
  const { details } = readDetails(row);
  const status = row.status as string;
  return {
    id: row.id,
    reference: details.ourReference,
    status,
    stage: details.stage,
    environment: details.environment,
    sandbox: details.environment !== "production",
    note: details.note,
    tour: details.tour,
    offer: details.offer,
    date: details.date,
    slot: details.slot ? { startTime: details.slot.startTime, endTime: details.slot.endTime } : null,
    pax: details.pax,
    guest: details.guest,
    supplier: { name: "Traveldesk", bookingId: details.supplierBookingId, status: details.supplierStatusName, bookingType: details.bookingType },
    reservationDeadline: details.reservationDeadline,
    ...(can(ctx.role, "cost:view") && { cost: details.cost }),
    cancellationPolicyRaw: details.cancellationPolicyRaw,
    customerSupportPhone: details.customerSupportPhone,
    customerPayment: "NOT_COLLECTED",
    canConfirm: status === "RESERVED" && can(ctx.role, "booking:manage"),
    canCancel: ["RESERVED", "PENDING_SUPPLIER", "CONFIRMED", "IN_PROGRESS"].includes(status) && can(ctx.role, "booking:manage"),
    canDownloadVoucher: status === "CONFIRMED",
    createdAt: row.createdAt.toISOString(),
    events: details.events,
  };
}

export async function listBookings(ctx: TenantContext): Promise<BookingView[]> {
  const customer = await ownCustomer(ctx);
  if (!customer) return [];
  const rows = await ctx.db.booking.findMany({
    where: { customerId: customer.id, idempotencyKey: { not: null } },
    include: { items: true },
    orderBy: { createdAt: "desc" },
    take: 50,
  });
  return rows.flatMap((r) => {
    try {
      return [toView(ctx, r)];
    } catch {
      return []; // not a Traveldesk booking
    }
  });
}

export async function getBooking(ctx: TenantContext, id: string): Promise<BookingView> {
  return toView(ctx, await requireOwn(ctx, id));
}

// ---------------------------------------------------------------------------------------------
// Reserve
// ---------------------------------------------------------------------------------------------

function pickSlot(slots: SlotResult[], input: ReserveInput): SlotResult {
  const wanted = input.timeSlotId !== undefined || input.startMinutes !== undefined;
  if (!wanted) {
    if (slots.length === 1) return slots[0];
    throw new BookingError("INVALID", "This offer has several time slots; choose one.");
  }
  const slot = slots.find(
    (s) => (input.timeSlotId === undefined || s.timeSlotId === input.timeSlotId) && (input.startMinutes === undefined || s.startMinutes === input.startMinutes)
  );
  if (!slot) throw new BookingError("UNAVAILABLE", "That time slot is not offered on this date.");
  return slot;
}

export async function reserveTraveldeskBooking(
  ctx: TenantContext,
  input: ReserveInput,
  idempotencyKey: string
): Promise<{ booking: BookingView; replay: boolean }> {
  const customer = await ownCustomer(ctx);
  if (!customer) throw new BookingError("NO_CUSTOMER", "Customer profile not found.");

  const key = `${ctx.tenantId}:${idempotencyKey}`;
  const existing = await ctx.db.booking.findFirst({ where: { idempotencyKey: key, customerId: customer.id }, include: { items: true } });
  if (existing) return { booking: toView(ctx, existing), replay: true };

  // A replay above is free; a new hold is not.
  await assertFeature(ctx, "bookings");
  await assertWithinLimit(ctx, "bookings");

  if (input.date < todayUtc()) throw new BookingError("INVALID", "The date is in the past.");
  const client = getClient();
  assertBookingAllowed(client);

  // 1. Re-check everything with the supplier. Nothing from the browser is trusted for price or slot.
  let availability;
  try {
    availability = await checkTravelDeskAvailability(client, {
      tourId: input.tourId,
      date: input.date,
      adults: input.adults,
      children: input.children,
      offerId: input.offerId,
    });
  } catch (error) {
    throw new BookingError("SUPPLIER_ERROR", error instanceof TravelDeskError ? error.message : "Traveldesk request failed");
  }
  const offer = availability.offers[0];
  if (!offer) throw new BookingError("UNAVAILABLE", "That offer does not belong to this tour.");
  const slot = pickSlot(offer.slots, input);
  if (!slot.available || slot.total === null) throw new BookingError("UNAVAILABLE", "Not available for these dates and guests.");
  if (!offer.withinPaxLimits) throw new BookingError("INVALID", "The number of guests is outside this offer's limits.");
  if (input.infants > 0 && offer.infantsAllowed === false) throw new BookingError("INVALID", "This offer does not accept infants.");
  if (offer.isDirectReporting === false && input.hotelId === undefined) throw new BookingError("INVALID", "This offer needs a pick-up hotel.");
  if (slot.currency !== "USD") throw new BookingError("INVALID", `Unsupported supplier currency ${slot.currency}.`);

  const ourReference = `MK-TD-${Date.now()}-${Math.random().toString(36).slice(2, 7).toUpperCase()}`;
  const base: Details = {
    supplier: "traveldesk",
    environment: availability.environment,
    stage: "RESERVING",
    confirmRequested: false,
    supplierBookingId: null,
    supplierStatus: null,
    supplierStatusName: null,
    bookingType: offer.bookingType,
    tour: availability.tour,
    offer: { id: offer.offerId, name: offer.name },
    date: input.date,
    slot: { timeSlotId: slot.timeSlotId, startMinutes: slot.startMinutes, endMinutes: slot.endMinutes, startTime: slot.startTime, endTime: slot.endTime },
    pax: { adults: input.adults, children: input.children, infants: input.infants },
    guest: { name: input.guestName, ...(input.email && { email: input.email }), ...(input.phone && { phone: input.phone }) },
    ...(input.hotelId !== undefined && { hotelId: input.hotelId }),
    ...(input.pickUpLocation && { pickUpLocation: input.pickUpLocation }),
    ...(input.remarks && { remarks: input.remarks }),
    cost: { currency: "USD", total: slot.total },
    reservedAt: null,
    reservationDeadline: null,
    cancellationPolicyRaw: availability.cancellationPolicyRaw,
    customerSupportPhone: null,
    note: "Asking the supplier to hold this booking.",
    customerPayment: "NOT_COLLECTED",
    ourReference,
    events: [],
  };
  base.events = event(base, "RESERVE_REQUESTED", `Reserve requested for ${slot.total} USD (supplier cost).`);

  // 2. Write our record first so a crash mid-call still leaves a trace of what was attempted.
  let created;
  try {
    created = await ctx.db.booking.create({
    data: {
      tenantId: ctx.tenantId,
      customerId: customer.id,
      reference: ourReference,
      status: "DRAFT",
      total: slot.total,
      currency: "USD",
      idempotencyKey: key,
      items: { create: { status: "DRAFT", details: base as unknown as Prisma.InputJsonValue } },
    },
    include: { items: true },
  });
  } catch (error) {
    // Two requests with the same Idempotency-Key raced: the loser returns the winner's booking.
    if (typeof error === "object" && error !== null && "code" in error && (error as { code?: unknown }).code === "P2002") {
      const winner = await ctx.db.booking.findFirst({ where: { idempotencyKey: key, customerId: customer.id }, include: { items: true } });
      if (winner) return { booking: toView(ctx, winner), replay: true };
    }
    throw error;
  }

  // 3. Ask the supplier. A POST is never retried automatically.
  try {
    const res = await client.reserve({
      date: input.date,
      offerId: offer.offerId,
      adults: input.adults,
      children: input.children,
      infants: input.infants,
      guestName: input.guestName,
      referenceNumber: ourReference,
      totalCost: slot.total,
      totalCostUsd: slot.total,
      currency: "USD",
      timeSlotId: slot.timeSlotId ?? undefined,
      startTime: slot.startMinutes ?? undefined,
      endTime: slot.endMinutes ?? undefined,
      hotelId: input.hotelId,
      pickUpLocation: input.pickUpLocation,
      email: input.email,
      phone: input.phone,
      remarks: input.remarks,
    });
    const mapped = mapSupplierBooking(res, false);
    const reservedAt = new Date();
    const next: Details = {
      ...base,
      stage: mapped.stage,
      supplierBookingId: res.id,
      supplierStatus: res.status,
      supplierStatusName: supplierStatusName(res.status),
      bookingType: res.bookingType ?? base.bookingType,
      reservedAt: reservedAt.toISOString(),
      reservationDeadline: reservationDeadline(reservedAt, res.reservationTimeout).toISOString(),
      customerSupportPhone: res.customerSupportPhone ?? null,
      note: mapped.note,
      events: event(base, "RESERVED", `Supplier booking id ${res.id}, status ${supplierStatusName(res.status)}.`),
    };
    await persist(ctx, created, mapped.status, next);
    void recordAudit({ tenantId: ctx.tenantId, userId: ctx.userId, action: "booking.reserved", entity: "Booking", entityId: created.id, metadata: { supplier: "traveldesk", supplierBookingId: res.id, environment: base.environment } });
    return { booking: await getBooking(ctx, created.id), replay: false };
  } catch (error) {
    const refused = error instanceof TravelDeskError && error.status !== undefined && error.status >= 400 && error.status < 500;
    const note = refused
      ? `The supplier refused the reservation${error instanceof TravelDeskError && error.detail ? `: ${error.detail}` : "."}`
      : "Could not confirm what the supplier did with the request. A hold may exist and will expire on its own within about 15 minutes.";
    await persist(ctx, created, "FAILED", { ...base, stage: refused ? "RESERVE_FAILED" : "RESERVE_UNKNOWN", note, events: event(base, refused ? "RESERVE_FAILED" : "RESERVE_UNKNOWN", note) });
    void recordAudit({ tenantId: ctx.tenantId, userId: ctx.userId, action: "booking.reserve_failed", entity: "Booking", entityId: created.id, metadata: { refused } });
    throw new BookingError("SUPPLIER_ERROR", note, { bookingId: created.id });
  }
}

// ---------------------------------------------------------------------------------------------
// Refresh / confirm / cancel / voucher
// ---------------------------------------------------------------------------------------------

async function applySupplierState(ctx: TenantContext, row: BookingRow, client: TravelDeskClient, eventType: string): Promise<BookingView> {
  const { details } = readDetails(row);
  if (details.supplierBookingId === null) throw new BookingError("WRONG_STATE", "This booking has no supplier booking yet.");
  let res;
  try {
    res = await client.booking(details.supplierBookingId);
  } catch (error) {
    throw new BookingError("SUPPLIER_ERROR", error instanceof TravelDeskError ? error.message : "Traveldesk request failed");
  }
  const mapped = mapSupplierBooking(res, details.confirmRequested);
  const next: Details = {
    ...details,
    stage: mapped.stage,
    supplierStatus: res.status,
    supplierStatusName: supplierStatusName(res.status),
    bookingType: res.bookingType ?? details.bookingType,
    customerSupportPhone: res.customerSupportPhone ?? details.customerSupportPhone,
    cancellationPolicyRaw: res.cancellationPolicy?.map((c) => ({ hours: c.hours, percents: c.percents })) ?? details.cancellationPolicyRaw,
    note: mapped.note,
    events: mapped.status === row.status ? details.events : event(details, eventType, `Supplier status ${supplierStatusName(res.status)} -> ${mapped.status}.`),
  };
  await persist(ctx, row, mapped.status, next);
  return getBooking(ctx, row.id);
}

/** Re-reads the supplier's view of the booking. Never moves a CANCELLED booking back to life. */
export async function refreshBooking(ctx: TenantContext, id: string): Promise<BookingView> {
  const row = await requireOwn(ctx, id);
  if (row.status === "CANCELLED" || row.status === "DRAFT" || row.status === "FAILED") return toView(ctx, row);
  return applySupplierState(ctx, row, getClient(), "REFRESHED");
}

export async function confirmBooking(ctx: TenantContext, id: string, expectedTotal: number): Promise<BookingView> {
  const row = await requireOwn(ctx, id);
  const { details } = readDetails(row);
  if (row.status !== "RESERVED") throw new BookingError("WRONG_STATE", `Only a held reservation can be confirmed (this one is ${row.status}).`);
  if (!sameAmount(expectedTotal, details.cost.total)) {
    throw new BookingError("PRICE_CHANGED", "The amount you approved does not match this booking.", { currentTotal: details.cost.total });
  }
  if (details.supplierBookingId === null) throw new BookingError("WRONG_STATE", "This booking has no supplier reservation.");
  const client = getClient();
  assertBookingAllowed(client);

  // Is the hold still alive at the supplier?
  const fresh = await applySupplierState(ctx, row, client, "PRE_CONFIRM_CHECK");
  if (fresh.status !== "RESERVED") throw new BookingError("WRONG_STATE", `The reservation is no longer held: ${fresh.note}`);

  // Has the price or availability moved since we reserved? Never charge a different amount than approved.
  try {
    const a = await checkTravelDeskAvailability(client, {
      tourId: details.tour.id,
      date: details.date,
      adults: details.pax.adults,
      children: details.pax.children,
      offerId: details.offer.id,
    });
    const slots = a.offers[0]?.slots ?? [];
    const slot = slots.find((s) => s.timeSlotId === details.slot?.timeSlotId && s.startMinutes === details.slot?.startMinutes) ?? (slots.length === 1 ? slots[0] : undefined);
    // A held seat may show as unavailable to new buyers, so availability is only informative; price is not.
    if (slot && slot.total !== null && !sameAmount(slot.total, details.cost.total)) {
      throw new BookingError("PRICE_CHANGED", "The supplier price changed since this was reserved. Nothing was charged.", { currentTotal: slot.total, reservedTotal: details.cost.total });
    }
  } catch (error) {
    if (error instanceof BookingError) throw error;
    throw new BookingError("SUPPLIER_ERROR", "Could not re-check the supplier price, so nothing was charged.");
  }

  // Claim the booking so a double click cannot send two confirmations.
  const claimed = await ctx.db.booking.updateMany({ where: { id: row.id, status: "RESERVED" }, data: { status: "IN_PROGRESS" } });
  if (claimed.count !== 1) throw new BookingError("WRONG_STATE", "This booking is already being processed.");

  const claimedRow = await requireOwn(ctx, id);
  const current = readDetails(claimedRow).details;
  await persist(ctx, claimedRow, "IN_PROGRESS", { ...current, stage: "CONFIRMING", note: "Confirming with the supplier.", events: event(current, "CONFIRM_REQUESTED", `Confirm requested for ${details.cost.total} USD.`) });
  void recordAudit({ tenantId: ctx.tenantId, userId: ctx.userId, action: "booking.confirm_requested", entity: "Booking", entityId: row.id, metadata: { supplierBookingId: details.supplierBookingId, total: details.cost.total } });

  try {
    const res = await client.confirm(details.supplierBookingId);
    const afterClaim = readDetails(await requireOwn(ctx, id)).details;
    const mapped = mapSupplierBooking(res, true);
    const latest = await requireOwn(ctx, id);
    await persist(ctx, latest, mapped.status, {
      ...afterClaim,
      confirmRequested: true,
      stage: mapped.stage,
      supplierStatus: res.status,
      supplierStatusName: supplierStatusName(res.status),
      customerSupportPhone: res.customerSupportPhone ?? afterClaim.customerSupportPhone,
      note: mapped.note,
      events: event(afterClaim, "CONFIRM_RESPONSE", `Supplier status ${supplierStatusName(res.status)} -> ${mapped.status}.`),
    });
    void recordAudit({ tenantId: ctx.tenantId, userId: ctx.userId, action: "booking.confirm_result", entity: "Booking", entityId: row.id, metadata: { status: mapped.status, supplierStatus: res.status } });
    return getBooking(ctx, id);
  } catch (error) {
    // The charge may or may not have happened. Ask the supplier before deciding anything.
    const afterClaim = readDetails(await requireOwn(ctx, id)).details;
    const refused = error instanceof TravelDeskError && error.status !== undefined && error.status >= 400 && error.status < 500;
    if (refused) {
      const note = `The supplier refused the confirmation${error instanceof TravelDeskError && error.detail ? `: ${error.detail}` : "."}`;
      const latest = await requireOwn(ctx, id);
      // The hold may still be alive; leave it RESERVED so the user can retry or cancel.
      await persist(ctx, latest, "RESERVED", { ...afterClaim, stage: "RESERVED", note, events: event(afterClaim, "CONFIRM_REFUSED", note) });
      throw new BookingError("SUPPLIER_ERROR", note);
    }
    const note = "The confirmation request did not complete cleanly. Use Refresh to see what the supplier recorded before trying again.";
    const latest = await requireOwn(ctx, id);
    await persist(ctx, latest, "IN_PROGRESS", { ...afterClaim, confirmRequested: true, stage: "CONFIRM_UNKNOWN", note, events: event(afterClaim, "CONFIRM_UNKNOWN", note) });
    throw new BookingError("SUPPLIER_ERROR", note);
  }
}

export async function cancelBooking(ctx: TenantContext, id: string): Promise<BookingView> {
  const row = await requireOwn(ctx, id);
  const { details } = readDetails(row);
  if (!["RESERVED", "PENDING_SUPPLIER", "CONFIRMED", "IN_PROGRESS"].includes(row.status)) {
    throw new BookingError("WRONG_STATE", `A ${row.status} booking cannot be cancelled.`);
  }
  if (details.supplierBookingId === null) throw new BookingError("WRONG_STATE", "This booking has no supplier booking to cancel.");
  const client = getClient();

  try {
    const res = await client.cancel(details.supplierBookingId);
    if (!res.isSuccess) throw new BookingError("SUPPLIER_ERROR", "The supplier did not accept the cancellation.");
  } catch (error) {
    if (error instanceof BookingError) throw error;
    const msg = error instanceof TravelDeskError && error.detail ? `The supplier refused the cancellation: ${error.detail}` : "The cancellation did not complete. Use Refresh to see the supplier's current status.";
    throw new BookingError("SUPPLIER_ERROR", msg);
  }
  const latest = await requireOwn(ctx, id);
  const d = readDetails(latest).details;
  await persist(ctx, latest, "CANCELLED", {
    ...d,
    stage: "CANCELLED",
    supplierStatus: 4,
    supplierStatusName: supplierStatusName(4),
    note: "Cancelled with the supplier. Any refund follows the supplier's cancellation policy; check the supplier's records for the amount.",
    events: event(d, "CANCELLED", "Supplier accepted the cancellation."),
  });
  void recordAudit({ tenantId: ctx.tenantId, userId: ctx.userId, action: "booking.cancelled", entity: "Booking", entityId: id, metadata: { supplierBookingId: details.supplierBookingId } });
  return getBooking(ctx, id);
}

/** The supplier's own voucher, proxied so the supplier's anonymous-access link never reaches the browser. */
export async function getVoucher(ctx: TenantContext, id: string): Promise<{ reference: string; bytes: Uint8Array }> {
  const row = await requireOwn(ctx, id);
  const { details } = readDetails(row);
  if (row.status !== "CONFIRMED" || details.supplierBookingId === null) {
    throw new BookingError("WRONG_STATE", "A voucher is only available once the supplier has confirmed the booking.");
  }
  const client = getClient();
  let voucher;
  try {
    voucher = await client.voucher(details.supplierBookingId);
  } catch (error) {
    throw new BookingError("SUPPLIER_ERROR", error instanceof TravelDeskError ? error.message : "Could not fetch the voucher.");
  }
  // Record that a voucher exists for this booking (one per booking).
  const existing = await ctx.db.voucher.findFirst({ where: { bookingId: row.id } });
  if (!existing) {
    await ctx.db.voucher.create({
      data: {
        tenantId: ctx.tenantId,
        bookingId: row.id,
        bookingItemId: row.items[0].id,
        reference: `VCH-${details.ourReference}`,
        status: "CONFIRMED",
        issuedAt: new Date(),
        payload: { source: "traveldesk", supplierBookingId: details.supplierBookingId, environment: details.environment } as unknown as Prisma.InputJsonValue,
      },
    });
  }
  void recordAudit({ tenantId: ctx.tenantId, userId: ctx.userId, action: "booking.voucher_downloaded", entity: "Booking", entityId: id });
  return { reference: details.ourReference, bytes: voucher.bytes };
}
