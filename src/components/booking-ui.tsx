"use client";

import type { BookingView } from "@/server/booking/traveldesk-booking";

/** Colours and wording shared by the booking screens. Status text is ours; the supplier's is shown beside it. */
export const STATUS_STYLE: Record<string, string> = {
  RESERVED: "bg-blue-100 text-blue-800",
  CONFIRMED: "bg-green-100 text-green-800",
  PENDING_SUPPLIER: "bg-amber-100 text-amber-800",
  IN_PROGRESS: "bg-amber-100 text-amber-800",
  PAYMENT_PENDING: "bg-amber-100 text-amber-800",
  FAILED: "bg-red-100 text-red-800",
  CANCELLED: "bg-gray-200 text-gray-700",
  DRAFT: "bg-gray-100 text-gray-700",
};

export const STATUS_LABEL: Record<string, string> = {
  RESERVED: "Held (not confirmed)",
  CONFIRMED: "Confirmed by supplier",
  PENDING_SUPPLIER: "Waiting for supplier",
  IN_PROGRESS: "In progress",
  PAYMENT_PENDING: "Payment pending",
  FAILED: "Failed",
  CANCELLED: "Cancelled",
  DRAFT: "Draft",
};

export function StatusBadge({ status }: { status: string }) {
  return (
    <span className={`rounded px-2 py-0.5 text-xs font-medium ${STATUS_STYLE[status] ?? "bg-gray-100 text-gray-700"}`}>
      {STATUS_LABEL[status] ?? status}
    </span>
  );
}

export function SandboxBanner() {
  return (
    <p role="note" className="rounded border border-amber-300 bg-amber-50 p-3 text-sm text-amber-900">
      <strong>Test environment.</strong> These bookings go to Traveldesk&apos;s test system. No real tour is booked and no real
      money moves.
    </p>
  );
}

export function describeSlot(b: Pick<BookingView, "slot">): string {
  if (!b.slot?.startTime) return "";
  return b.slot.endTime ? `${b.slot.startTime}-${b.slot.endTime}` : b.slot.startTime;
}
