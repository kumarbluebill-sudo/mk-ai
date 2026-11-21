import { PDFDocument, StandardFonts, rgb, type PDFFont, type PDFPage } from "pdf-lib";
import type { QuoteDocument } from "./document";

/**
 * Renders a QuoteDocument to an A4 PDF with pdf-lib (pure JS, works on serverless).
 *
 * Limitation: the built-in PDF fonts only cover Western (WinAnsi) characters. The rupee sign and
 * non-Latin scripts (Tamil, Hindi...) cannot be drawn, so currency is written as a code ("INR") and
 * unsupported characters become "?". Embedding a Unicode font is the fix when it is needed.
 */

const PAGE_W = 595.28;
const PAGE_H = 841.89;
const MARGIN = 48;
const CONTENT_W = PAGE_W - MARGIN * 2;

const INK = rgb(0.1, 0.1, 0.12);
const MUTED = rgb(0.4, 0.42, 0.47);
const ACCENT = rgb(0.15, 0.39, 0.92);
const RULE = rgb(0.85, 0.86, 0.88);

/** Replace anything the standard font cannot encode so rendering never throws. */
export function sanitize(text: string, font: PDFFont): string {
  const normalised = text.replace(/\r?\n/g, " ").replace(/[‐-―]/g, "-").replace(/[‘’]/g, "'").replace(/[“”]/g, '"');
  let out = "";
  for (const ch of normalised) {
    try {
      font.encodeText(ch);
      out += ch;
    } catch {
      out += "?";
    }
  }
  return out;
}

export function formatMoney(amount: number, currency: string): string {
  const [whole, frac] = amount.toFixed(2).split(".");
  // Western grouping for every currency: no locale data is assumed on the server.
  return `${currency} ${whole.replace(/\B(?=(\d{3})+(?!\d))/g, ",")}.${frac}`;
}

class Writer {
  page!: PDFPage;
  y = 0;
  constructor(
    readonly pdf: PDFDocument,
    readonly regular: PDFFont,
    readonly bold: PDFFont
  ) {
    this.addPage();
  }

  addPage() {
    this.page = this.pdf.addPage([PAGE_W, PAGE_H]);
    this.y = PAGE_H - MARGIN;
  }

  ensure(height: number) {
    if (this.y - height < MARGIN + 24) this.addPage();
  }

  wrap(text: string, font: PDFFont, size: number, width: number): string[] {
    const words = sanitize(text, font).split(/\s+/).filter(Boolean);
    const lines: string[] = [];
    let line = "";
    for (const word of words) {
      const candidate = line ? `${line} ${word}` : word;
      if (font.widthOfTextAtSize(candidate, size) <= width) {
        line = candidate;
        continue;
      }
      if (line) lines.push(line);
      // A single word longer than the line is hard-split so it cannot overflow the page.
      let rest = word;
      while (font.widthOfTextAtSize(rest, size) > width) {
        let n = rest.length;
        while (n > 1 && font.widthOfTextAtSize(rest.slice(0, n), size) > width) n--;
        lines.push(rest.slice(0, n));
        rest = rest.slice(n);
      }
      line = rest;
    }
    if (line) lines.push(line);
    return lines.length ? lines : [""];
  }

  text(text: string, opts: { size?: number; bold?: boolean; color?: ReturnType<typeof rgb>; x?: number; width?: number; gap?: number } = {}) {
    const size = opts.size ?? 10;
    const font = opts.bold ? this.bold : this.regular;
    const x = opts.x ?? MARGIN;
    const lines = this.wrap(text, font, size, opts.width ?? CONTENT_W - (x - MARGIN));
    const lh = size * 1.35;
    for (const l of lines) {
      this.ensure(lh);
      this.y -= lh;
      this.page.drawText(l, { x, y: this.y, size, font, color: opts.color ?? INK });
    }
    this.y -= opts.gap ?? 0;
  }

  /** Right-aligned text on the current line position (does not move y). */
  right(text: string, y: number, opts: { size?: number; bold?: boolean; color?: ReturnType<typeof rgb> } = {}) {
    const size = opts.size ?? 10;
    const font = opts.bold ? this.bold : this.regular;
    const t = sanitize(text, font);
    this.page.drawText(t, { x: PAGE_W - MARGIN - font.widthOfTextAtSize(t, size), y, size, font, color: opts.color ?? INK });
  }

  rule(gap = 8) {
    this.ensure(gap * 2);
    this.y -= gap;
    this.page.drawLine({ start: { x: MARGIN, y: this.y }, end: { x: PAGE_W - MARGIN, y: this.y }, thickness: 0.6, color: RULE });
    this.y -= gap;
  }
}

export async function renderQuotePdf(doc: QuoteDocument): Promise<Uint8Array> {
  const pdf = await PDFDocument.create();
  pdf.setTitle(`Quotation ${doc.reference}`);
  pdf.setProducer("MK AI Travel");
  const regular = await pdf.embedFont(StandardFonts.Helvetica);
  const bold = await pdf.embedFont(StandardFonts.HelveticaBold);
  const w = new Writer(pdf, regular, bold);

  // Header: company left, quote meta right.
  const headerTop = w.y;
  w.text(doc.company.name, { size: 18, bold: true, color: ACCENT, width: CONTENT_W * 0.6 });
  for (const line of [doc.company.address, [doc.company.phone, doc.company.email].filter(Boolean).join("  |  "), doc.company.website, doc.company.gstNumber ? `GSTIN: ${doc.company.gstNumber}` : undefined]) {
    if (line) w.text(line, { size: 9, color: MUTED, width: CONTENT_W * 0.6 });
  }
  const leftEnd = w.y;
  w.y = headerTop;
  w.right("QUOTATION", w.y - 16, { size: 16, bold: true });
  w.right(`Ref: ${doc.reference}`, w.y - 32, { size: 9, color: MUTED });
  w.right(`Issued: ${doc.issuedAt}`, w.y - 44, { size: 9, color: MUTED });
  w.right(`Valid until: ${doc.validUntil}`, w.y - 56, { size: 9, color: MUTED });
  w.y = Math.min(leftEnd, headerTop - 62);
  w.rule(10);

  w.text(`Prepared for: ${doc.customerName}`, { bold: true, size: 11 });
  w.text(doc.trip.title, { size: 14, bold: true, gap: 2 });
  w.text(`${doc.trip.destination}${doc.trip.startDate ? `  |  Starts ${doc.trip.startDate}` : ""}  |  ${doc.trip.days.length} day${doc.trip.days.length === 1 ? "" : "s"}`, { size: 9, color: MUTED, gap: 6 });

  // Itinerary.
  w.text("Itinerary", { size: 12, bold: true, color: ACCENT, gap: 2 });
  for (const day of doc.trip.days) {
    w.ensure(40);
    w.text(`Day ${day.dayNumber}${day.date ? `  (${day.date})` : ""}: ${day.title}`, { bold: true, size: 10.5, gap: 1 });
    if (day.items.length === 0) w.text("Free time / to be planned", { size: 9, color: MUTED, x: MARGIN + 12 });
    for (const item of day.items) {
      const label = `${item.time ? `${item.time}  ` : ""}${item.title}${item.location ? ` - ${item.location}` : ""}${item.indicative ? "  (indicative)" : ""}`;
      w.text(`- ${label}`, { size: 9.5, x: MARGIN + 12 });
    }
    w.y -= 6;
  }

  // Price summary. Cost and markup are never listed; the package price already includes both.
  w.ensure(150);
  w.rule(6);
  w.text("Price summary", { size: 12, bold: true, color: ACCENT, gap: 2 });
  const row = (label: string, amount: string, strong = false) => {
    w.ensure(16);
    w.y -= 14;
    w.page.drawText(sanitize(label, strong ? bold : regular), { x: MARGIN, y: w.y, size: strong ? 11 : 10, font: strong ? bold : regular, color: INK });
    w.right(amount, w.y, { size: strong ? 11 : 10, bold: strong });
  };
  const cur = doc.price.currency;
  row("Package price", formatMoney(doc.price.packagePrice, cur));
  if (doc.price.discount > 0) row("Discount", `- ${formatMoney(doc.price.discount, cur)}`);
  if (doc.price.taxLines.length > 0) {
    row("Amount before tax", formatMoney(doc.price.taxable, cur));
    for (const t of doc.price.taxLines) row(`${t.label} @ ${+t.ratePercent.toFixed(4)}%`, formatMoney(t.amount, cur));
  }
  w.rule(4);
  row("Total", formatMoney(doc.price.total, cur), true);
  w.y -= 10;

  // Notices.
  w.ensure(60);
  w.text("Important", { size: 11, bold: true, color: ACCENT, gap: 2 });
  for (const d of doc.disclaimers) w.text(`- ${d}`, { size: 9, color: MUTED });
  if (doc.company.terms) {
    w.y -= 6;
    w.text("Terms and conditions", { size: 11, bold: true, color: ACCENT, gap: 2 });
    w.text(doc.company.terms, { size: 9, color: MUTED });
  }

  // Footer with page numbers on every page.
  const pages = pdf.getPages();
  pages.forEach((p, i) => {
    const label = `${doc.reference}  |  Page ${i + 1} of ${pages.length}`;
    p.drawText(label, { x: MARGIN, y: 24, size: 8, font: regular, color: MUTED });
  });

  return pdf.save();
}
