import { PDFDocument } from "pdf-lib";
import { describe, expect, it } from "vitest";
import { createItinerary } from "@/server/travel/itinerary";
import { calculatePackagePrice } from "@/server/travel/pricing";
import { buildQuoteDocument, type QuoteDocument } from "./document";
import { formatMoney, renderQuotePdf } from "./pdf";

const itinerary = createItinerary({
  title: "Dubai Family Escape",
  destination: "Dubai",
  startDate: "2026-12-15",
  days: [
    { title: "Arrival", items: [
      { title: "Airport transfer", category: "transfer", status: "ESTIMATE", price: 40, currency: "INR" },
    ] },
    { title: "Safari", items: [
      { title: "Desert safari", category: "adventure", status: "LIVE", price: 1000, currency: "INR", startTime: "15:00", endTime: "21:00", location: "Dubai desert" },
    ] },
  ],
});

function price() {
  return calculatePackagePrice({
    lines: [
      { name: "Airport transfer", unitCost: 40, quantity: 1, currency: "INR" },
      { name: "Desert safari", unitCost: 1000, quantity: 1, currency: "INR" },
    ],
    markup: { percentage: 10 },
    discount: 54,
    gst: { ratePercent: 5, supply: "INTRA_STATE" },
  });
}

function doc(over: Partial<Parameters<typeof buildQuoteDocument>[0]> = {}): QuoteDocument {
  return buildQuoteDocument({
    reference: "QT-1",
    issuedAt: new Date("2026-11-21T00:00:00Z"),
    validUntil: new Date("2026-11-24T00:00:00Z"),
    company: { name: "Alpha Travels", gstNumber: "29ABCDE1234F1Z5" },
    customerName: "Asha",
    itinerary,
    price: price(),
    ...over,
  });
}

describe("buildQuoteDocument", () => {
  it("folds markup into the package price and never exposes cost or markup", () => {
    const d = doc();
    // cost 1040 + 10% markup 104 = 1144; discount 54 -> taxable 1090; GST 5% = 54.50
    expect(d.price.packagePrice).toBe(1144);
    expect(d.price.taxable).toBe(1090);
    expect(d.price.total).toBe(1144.5);
    const json = JSON.stringify(d);
    expect(json).not.toMatch(/markup|supplierCost|unitCost|subtotal/i);
  });

  it("carries the CGST/SGST split", () => {
    expect(doc().price.taxLines.map((t) => t.label)).toEqual(["CGST", "SGST"]);
  });

  it("marks non-LIVE items indicative and says so in the notices", () => {
    const d = doc();
    const items = d.trip.days.flatMap((x) => x.items);
    expect(items.find((i) => i.title === "Airport transfer")?.indicative).toBe(true);
    expect(items.find((i) => i.title === "Desert safari")?.indicative).toBe(false);
    expect(d.disclaimers.join(" ")).toMatch(/1 of 2/);
  });

  it("never claims a confirmed booking", () => {
    const text = JSON.stringify(doc().disclaimers);
    expect(text).toMatch(/not a booking confirmation/i);
    expect(text).not.toMatch(/(your|this) booking (is|has been) confirmed|booked successfully|payment received/i);
  });

  it("formats money with grouping and two decimals", () => {
    expect(formatMoney(1234567.5, "INR")).toBe("INR 1,234,567.50");
    expect(formatMoney(0.5, "USD")).toBe("USD 0.50");
  });
});

describe("renderQuotePdf", () => {
  it("produces a parseable PDF", async () => {
    const bytes = await renderQuotePdf(doc());
    expect(Buffer.from(bytes.slice(0, 5)).toString()).toBe("%PDF-");
    const parsed = await PDFDocument.load(bytes);
    expect(parsed.getPageCount()).toBe(1);
    expect(parsed.getTitle()).toBe("Quotation QT-1");
  });

  it("does not throw on characters the built-in font cannot draw", async () => {
    const d = doc({ customerName: "அசா Ṛṣi ₹ 😀", company: { name: "ஆல்பா Travels" } });
    const bytes = await renderQuotePdf(d);
    expect(bytes.length).toBeGreaterThan(500);
  });

  it("paginates long itineraries and survives very long unbroken words", async () => {
    const long = createItinerary({
      title: "Long",
      destination: "X",
      days: Array.from({ length: 12 }, (_, i) => ({
        title: `Day title ${i + 1}`,
        items: Array.from({ length: 8 }, (_, j) => ({ title: `Activity ${j} ${"w".repeat(120)}`, category: "other" as const, status: "UNVERIFIED" as const })),
      })),
    });
    const bytes = await renderQuotePdf(doc({ itinerary: long }));
    const parsed = await PDFDocument.load(bytes);
    expect(parsed.getPageCount()).toBeGreaterThan(2);
  });
});
