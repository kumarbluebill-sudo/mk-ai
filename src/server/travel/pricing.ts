/**
 * Package pricing in integer minor units (cents/paise) to avoid float drift.
 * No currency conversion happens here: mixed currencies are rejected rather than guessed.
 */

export interface PriceLine {
  name: string;
  /** Supplier cost per unit, in major units (e.g. 120.50). */
  unitCost: number;
  quantity: number;
  currency: string;
}

export interface MarkupRule {
  /** Percentage, e.g. 12.5 means 12.5%. */
  percentage?: number;
  /** Fixed amount in major units, added once per package. */
  fixedAmount?: number;
}

export interface PriceInput {
  lines: PriceLine[];
  markup?: MarkupRule;
  /** Tax percentage applied on (subtotal + markup - discount), e.g. GST 18. */
  taxPercent?: number;
  /**
   * Indian GST split. Mutually exclusive with taxPercent. The rate is supplied by the caller (your
   * accountant decides it for the service); nothing here hardcodes statutory rates or TCS.
   * INTRA_STATE splits it into CGST + SGST halves, INTER_STATE charges IGST.
   */
  gst?: { ratePercent: number; supply: "INTRA_STATE" | "INTER_STATE" };
  /** Discount in major units. */
  discount?: number;
}

export interface TaxLine {
  label: string;
  ratePercent: number;
  amount: number;
}

export interface PriceBreakdown {
  currency: string;
  subtotal: number;
  markup: number;
  discount: number;
  /** Amount tax is charged on: subtotal + markup - discount. */
  taxable: number;
  taxes: number;
  taxLines: TaxLine[];
  total: number;
  lines: { name: string; quantity: number; unitCost: number; lineTotal: number }[];
}

export class PricingError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "PricingError";
  }
}

const toMinor = (v: number) => Math.round(v * 100);
const toMajor = (v: number) => v / 100;

export function calculatePackagePrice(input: PriceInput): PriceBreakdown {
  if (input.lines.length === 0) throw new PricingError("At least one price line is required");

  const currencies = new Set(input.lines.map((l) => l.currency.toUpperCase()));
  if (currencies.size > 1) {
    throw new PricingError(`Mixed currencies (${[...currencies].join(", ")}); conversion rates are not configured`);
  }
  const currency = [...currencies][0];

  for (const l of input.lines) {
    if (!Number.isFinite(l.unitCost) || l.unitCost < 0) throw new PricingError(`Invalid cost for "${l.name}"`);
    if (!Number.isInteger(l.quantity) || l.quantity < 1) throw new PricingError(`Invalid quantity for "${l.name}"`);
  }

  const lines = input.lines.map((l) => ({
    name: l.name,
    quantity: l.quantity,
    unitCost: l.unitCost,
    lineMinor: toMinor(l.unitCost) * l.quantity,
  }));
  const subtotal = lines.reduce((s, l) => s + l.lineMinor, 0);

  const pct = input.markup?.percentage ?? 0;
  const fixed = toMinor(input.markup?.fixedAmount ?? 0);
  if (pct < 0 || fixed < 0) throw new PricingError("Markup cannot be negative");
  const markup = Math.round((subtotal * pct) / 100) + fixed;

  const discount = toMinor(input.discount ?? 0);
  if (discount < 0 || discount > subtotal + markup) throw new PricingError("Invalid discount");

  const taxable = subtotal + markup - discount;
  const taxPct = input.taxPercent ?? 0;
  if (taxPct < 0) throw new PricingError("Tax cannot be negative");
  if (input.gst && taxPct > 0) throw new PricingError("Use either taxPercent or gst, not both");

  const taxLinesMinor: { label: string; ratePercent: number; minor: number }[] = [];
  if (input.gst) {
    const rate = input.gst.ratePercent;
    if (!Number.isFinite(rate) || rate < 0 || rate > 100) throw new PricingError("GST rate must be between 0 and 100");
    const total = Math.round((taxable * rate) / 100);
    if (input.gst.supply === "INTER_STATE") {
      taxLinesMinor.push({ label: "IGST", ratePercent: rate, minor: total });
    } else {
      // Halves always add back up to the exact total, so no paisa is lost or invented.
      const cgst = Math.floor(total / 2);
      taxLinesMinor.push({ label: "CGST", ratePercent: rate / 2, minor: cgst });
      taxLinesMinor.push({ label: "SGST", ratePercent: rate / 2, minor: total - cgst });
    }
  } else if (taxPct > 0) {
    taxLinesMinor.push({ label: "Tax", ratePercent: taxPct, minor: Math.round((taxable * taxPct) / 100) });
  }
  const taxes = taxLinesMinor.reduce((sum, t) => sum + t.minor, 0);

  return {
    currency,
    subtotal: toMajor(subtotal),
    markup: toMajor(markup),
    discount: toMajor(discount),
    taxable: toMajor(taxable),
    taxes: toMajor(taxes),
    taxLines: taxLinesMinor.map((t) => ({ label: t.label, ratePercent: t.ratePercent, amount: toMajor(t.minor) })),
    total: toMajor(taxable + taxes),
    lines: lines.map((l) => ({
      name: l.name,
      quantity: l.quantity,
      unitCost: l.unitCost,
      lineTotal: toMajor(l.lineMinor),
    })),
  };
}
