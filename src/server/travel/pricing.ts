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
  /** Discount in major units. */
  discount?: number;
}

export interface PriceBreakdown {
  currency: string;
  subtotal: number;
  markup: number;
  discount: number;
  taxes: number;
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
  const taxes = Math.round((taxable * taxPct) / 100);

  return {
    currency,
    subtotal: toMajor(subtotal),
    markup: toMajor(markup),
    discount: toMajor(discount),
    taxes: toMajor(taxes),
    total: toMajor(taxable + taxes),
    lines: lines.map((l) => ({
      name: l.name,
      quantity: l.quantity,
      unitCost: l.unitCost,
      lineTotal: toMajor(l.lineMinor),
    })),
  };
}
