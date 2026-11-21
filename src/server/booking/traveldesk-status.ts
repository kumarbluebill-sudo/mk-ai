import { BOOKING_STATUS, type TravelDeskBooking } from "@/integrations/traveldesk/client";

/**
 * Maps what Traveldesk reports to our booking status. This is the only place that can decide a
 * booking is CONFIRMED, and it only ever does so from a supplier response, never from our own
 * assumptions about a request having been sent.
 */

export type LocalBookingStatus =
  | "RESERVED"
  | "PENDING_SUPPLIER"
  | "PAYMENT_PENDING"
  | "IN_PROGRESS"
  | "CONFIRMED"
  | "FAILED"
  | "CANCELLED";

export type Stage =
  | "RESERVING"
  | "RESERVE_FAILED"
  | "RESERVE_UNKNOWN"
  | "RESERVED"
  | "CONFIRMING"
  | "CONFIRM_UNKNOWN"
  | "CONFIRMED"
  | "PENDING_SUPPLIER"
  | "CANCELLED"
  | "FAILED";

const NAMES: Record<number, string> = {
  0: "New",
  1: "PendingVerification",
  2: "PendingOnRequest",
  3: "PaymentRequired",
  4: "Cancelled",
  5: "Completed",
  6: "PaymentFailed",
  7: "Prebooked",
  8: "TimedOut",
};

export const supplierStatusName = (code: number): string => NAMES[code] ?? `Unknown(${code})`;

export interface Mapped {
  status: LocalBookingStatus;
  stage: Stage;
  /** Plain-language explanation shown next to the status. */
  note: string;
}

/**
 * @param confirmRequested true once WE have sent a confirm request that the supplier accepted (HTTP 200).
 *   It is needed because a LiveBook booking reports PendingVerification after confirmation, which is
 *   indistinguishable from "not confirmed yet" without knowing the confirm call succeeded.
 */
export function mapSupplierBooking(b: TravelDeskBooking, confirmRequested: boolean): Mapped {
  const code = b.status;

  if (b.isExternalBookingFailed) {
    return { status: "FAILED", stage: "FAILED", note: b.externalBookingFailureMessage ?? "The supplier could not confirm this booking." };
  }
  switch (code) {
    case BOOKING_STATUS.Cancelled:
      return { status: "CANCELLED", stage: "CANCELLED", note: "Cancelled with the supplier." };
    case BOOKING_STATUS.TimedOut:
      return { status: "FAILED", stage: "FAILED", note: "The reservation hold expired before it was confirmed." };
    case BOOKING_STATUS.PaymentFailed:
      return { status: "FAILED", stage: "FAILED", note: b.paymentErrorMessage ?? "The supplier could not take payment." };
    case BOOKING_STATUS.PaymentRequired:
      return { status: "PAYMENT_PENDING", stage: "CONFIRMING", note: "The supplier is waiting for payment." };
    case BOOKING_STATUS.Prebooked:
      return { status: "RESERVED", stage: "RESERVED", note: "Held with the supplier for a short time. Not confirmed and not charged." };
    case BOOKING_STATUS.PendingOnRequest:
      return { status: "PENDING_SUPPLIER", stage: "PENDING_SUPPLIER", note: "On-request item: the supplier has to approve it. Not confirmed yet." };
    case BOOKING_STATUS.Completed:
      return { status: "CONFIRMED", stage: "CONFIRMED", note: "Confirmed by the supplier." };
    case BOOKING_STATUS.New:
    case BOOKING_STATUS.PendingVerification: {
      if (!confirmRequested) {
        return { status: "IN_PROGRESS", stage: "CONFIRMING", note: "The supplier is still processing this booking." };
      }
      if (b.isExternalConfirmationInProgress) {
        return { status: "IN_PROGRESS", stage: "CONFIRMING", note: "Waiting for the supplier's own confirmation." };
      }
      // bookingType: 0 OnRequest, 1 LiveBook, 2 TicketOnly.
      if (b.bookingType === 0) {
        return { status: "PENDING_SUPPLIER", stage: "PENDING_SUPPLIER", note: "On-request item: the supplier has to approve it. Not confirmed yet." };
      }
      return {
        status: "CONFIRMED",
        stage: "CONFIRMED",
        note: `Accepted by the supplier. Its status reads "${supplierStatusName(code)}", which is how Traveldesk reports an instantly-bookable item after confirmation. Confirm this meaning with Traveldesk before going live.`,
      };
    }
    default:
      return { status: "IN_PROGRESS", stage: "CONFIRMING", note: `Unrecognised supplier status ${code}; treated as not confirmed.` };
  }
}

/** Hold deadline from OUR clock and the supplier's stated timeout; the supplier's own timestamp has no timezone. */
export function reservationDeadline(reservedAt: Date, timeoutMinutes: number | null | undefined): Date {
  const minutes = typeof timeoutMinutes === "number" && timeoutMinutes > 0 ? timeoutMinutes : 15;
  return new Date(reservedAt.getTime() + minutes * 60_000);
}

/** True when two money amounts agree to the cent. */
export function sameAmount(a: number, b: number): boolean {
  return Math.round(a * 100) === Math.round(b * 100);
}
