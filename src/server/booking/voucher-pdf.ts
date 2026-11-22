import { PDFDocument, StandardFonts, rgb, type PDFFont, type PDFPage } from "pdf-lib";
import { sanitize } from "@/server/quotation/pdf";
import type { BookingView } from "./traveldesk-booking";

/**
 * The agency's own booking voucher. Every fact on it comes from the stored booking, which in turn comes
 * from the supplier's responses. It is only produced for a booking the supplier has confirmed, shows the
 * supplier's status word-for-word, and says plainly that the supplier's own voucher is the document the
 * supplier recognises. Test (sandbox) bookings are stamped as such.
 */

const W = 595.28;
const H = 841.89;
const M = 48;
const INK = rgb(0.1, 0.1, 0.12);
const MUTED = rgb(0.4, 0.42, 0.47);
const ACCENT = rgb(0.15, 0.39, 0.92);
const RULE = rgb(0.85, 0.86, 0.88);
const RED = rgb(0.7, 0.1, 0.1);

export class VoucherNotAllowedError extends Error {
  constructor() {
    super("A voucher is only available once the supplier has confirmed the booking.");
    this.name = "VoucherNotAllowedError";
  }
}

export interface VoucherAgency {
  name: string;
  address?: string;
  phone?: string;
  email?: string;
}

function wrap(text: string, font: PDFFont, size: number, width: number): string[] {
  const lines: string[] = [];
  let line = "";
  for (const word of text.split(/\s+/).filter(Boolean)) {
    const next = line ? `${line} ${word}` : word;
    if (font.widthOfTextAtSize(next, size) <= width) line = next;
    else {
      if (line) lines.push(line);
      line = word;
    }
  }
  if (line) lines.push(line);
  return lines.length ? lines : [""];
}

export function describeCancellation(tiers: { hours: number; percents: number }[]): string[] {
  if (tiers.length === 0) return ["The supplier did not publish a cancellation policy with this booking. Ask the agency before relying on a refund."];
  return [...tiers]
    .sort((a, b) => b.hours - a.hours)
    .map((t) => `Cancelled ${t.hours} hours or more before the start: ${t.percents}% of the price is refunded (as published by the supplier).`);
}

export async function renderVoucher(view: BookingView, agency: VoucherAgency): Promise<Uint8Array> {
  if (view.status !== "CONFIRMED") throw new VoucherNotAllowedError();

  const pdf = await PDFDocument.create();
  const regular = await pdf.embedFont(StandardFonts.Helvetica);
  const bold = await pdf.embedFont(StandardFonts.HelveticaBold);
  const page: PDFPage = pdf.addPage([W, H]);
  let y = H - M;

  const text = (s: string, o: { size?: number; font?: PDFFont; color?: ReturnType<typeof rgb>; x?: number } = {}) => {
    const size = o.size ?? 10;
    const font = o.font ?? regular;
    for (const l of wrap(sanitize(s, font), font, size, W - M * 2 - (o.x ?? 0))) {
      page.drawText(l, { x: M + (o.x ?? 0), y, size, font, color: o.color ?? INK });
      y -= size + 4;
    }
  };
  const rule = () => {
    y -= 4;
    page.drawLine({ start: { x: M, y }, end: { x: W - M, y }, thickness: 0.7, color: RULE });
    y -= 14;
  };
  const row = (label: string, value: string) => {
    page.drawText(sanitize(label, regular), { x: M, y, size: 9, font: regular, color: MUTED });
    const lines = wrap(sanitize(value, bold), bold, 10, W - M * 2 - 140);
    for (const l of lines) {
      page.drawText(l, { x: M + 140, y, size: 10, font: bold, color: INK });
      y -= 14;
    }
    if (lines.length === 0) y -= 14;
  };

  text(agency.name, { size: 18, font: bold, color: ACCENT });
  const contact = [agency.address, agency.phone, agency.email].filter(Boolean).join("  |  ");
  if (contact) text(contact, { size: 9, color: MUTED });
  y -= 6;
  text("BOOKING VOUCHER", { size: 14, font: bold });
  if (view.sandbox) {
    text("TEST BOOKING. Made in the supplier's test environment. Not valid for travel.", { size: 11, font: bold, color: RED });
  }
  rule();

  row("Our reference", view.reference);
  row("Supplier", "Traveldesk");
  row("Supplier booking number", view.supplier.bookingId !== null ? String(view.supplier.bookingId) : "Not provided");
  row("Supplier status", view.supplier.status ?? "Not provided");
  rule();
  row("Tour", view.tour.name);
  row("Option", view.offer.name);
  row("Date", view.date);
  row("Time", view.slot ? [view.slot.startTime, view.slot.endTime].filter(Boolean).join(" to ") || "As agreed with the supplier" : "Not applicable");
  row("Guests", `${view.pax.adults} adult(s), ${view.pax.children} child(ren), ${view.pax.infants} infant(s)`);
  rule();
  row("Lead guest", view.guest.name);
  if (view.guest.phone) row("Guest phone", view.guest.phone);
  if (view.guest.email) row("Guest email", view.guest.email);
  if (view.customerSupportPhone) row("Supplier support", view.customerSupportPhone);
  rule();

  text("Cancellation", { font: bold });
  for (const l of describeCancellation(view.cancellationPolicyRaw)) text(l, { size: 9, color: MUTED });
  y -= 6;
  text(
    "This voucher was issued by the agency from the supplier's booking record. The supplier's own voucher is the document the supplier recognises; carry it too if the agency has provided one. If anything here differs from the supplier's voucher, the supplier's voucher applies.",
    { size: 8.5, color: MUTED }
  );
  text(`Issued ${new Date().toISOString().slice(0, 10)}`, { size: 8.5, color: MUTED });

  return pdf.save();
}
