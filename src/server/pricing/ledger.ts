import type { PriceBreakdown } from "@/server/travel/pricing";

/**
 * Append-only financial ledger. A quotation writes one set of entries when it is created. Entries are never
 * edited or deleted (the database refuses both); a correction is a new entry that reverses an earlier one.
 * Amounts are in major units of the entry's currency and signed: discounts and reversals are negative.
 *
 *   selling total = supplier cost + markup - discount + tax
 *   gross margin  = markup - discount            (tax is passed on, it is never profit)
 *   net margin    = gross margin - commission
 */

export const LEDGER_KINDS = ["SUPPLIER_COST", "MARKUP", "DISCOUNT", "TAX", "SELLING_TOTAL", "COMMISSION"] as const;
export type LedgerKind = (typeof LEDGER_KINDS)[number];

export interface LedgerDraft {
  kind: LedgerKind;
  amount: number;
  currency: string;
  supplierKey?: string | null;
  label?: string | null;
  ruleId?: string | null;
  userId?: string | null;
}

export interface LineAttribution {
  /** Supplier adapter id of the line, when it came from one. */
  supplierKey: string | null;
  /** Id of the markup rule applied to this line, if any. */
  ruleId: string | null;
}

const minor = (v: number) => Math.round(v * 100);
const major = (v: number) => v / 100;

export interface CommissionInput {
  userId: string;
  ruleId: string;
  /** Percentage of gross margin, 0-100. */
  percentage: number;
}

/** The commission in minor units: a share of the gross margin, never negative, never above the margin. */
export function commissionMinor(grossMarginMinor: number, percentage: number): number {
  if (grossMarginMinor <= 0 || percentage <= 0) return 0;
  return Math.min(grossMarginMinor, Math.round((grossMarginMinor * percentage) / 100));
}

/** Pure: turns a priced quotation into its ledger entries. */
export function quotationLedgerDrafts(price: PriceBreakdown, lines: readonly LineAttribution[], commission?: CommissionInput): LedgerDraft[] {
  const drafts: LedgerDraft[] = [];
  price.lines.forEach((line, i) => {
    const attr = lines[i] ?? { supplierKey: null, ruleId: null };
    drafts.push({ kind: "SUPPLIER_COST", amount: line.lineTotal, currency: price.currency, supplierKey: attr.supplierKey, label: line.name });
    if (line.markup > 0) drafts.push({ kind: "MARKUP", amount: line.markup, currency: price.currency, supplierKey: attr.supplierKey, label: line.name, ruleId: attr.ruleId });
  });
  // Package-level markup (not tied to a line) is the part of the markup not explained by the lines.
  const lineMarkups = price.lines.reduce((s, l) => s + minor(l.markup), 0);
  const extra = minor(price.markup) - lineMarkups;
  if (extra > 0) drafts.push({ kind: "MARKUP", amount: major(extra), currency: price.currency, label: "Package markup" });
  if (price.discount > 0) drafts.push({ kind: "DISCOUNT", amount: -price.discount, currency: price.currency, label: "Discount" });
  if (price.taxes > 0) drafts.push({ kind: "TAX", amount: price.taxes, currency: price.currency, label: price.taxLines.map((t) => t.label).join(" + ") || "Tax" });
  drafts.push({ kind: "SELLING_TOTAL", amount: price.total, currency: price.currency, label: "Selling price" });
  if (commission) {
    const gross = minor(price.markup) - minor(price.discount);
    const c = commissionMinor(gross, commission.percentage);
    if (c > 0) drafts.push({ kind: "COMMISSION", amount: major(c), currency: price.currency, label: `${commission.percentage}% of margin`, ruleId: commission.ruleId, userId: commission.userId });
  }
  return drafts;
}

export interface MarginSummary {
  currency: string;
  supplierCost: number;
  markup: number;
  discount: number;
  tax: number;
  sellingTotal: number;
  grossMargin: number;
  commission: number;
  netMargin: number;
}

interface EntryLike {
  kind: string;
  amount: number;
  currency: string;
}

/** Sums entries (reversals included, they are negative) into the figures an owner reads. Pure. */
export function marginSummary(entries: readonly EntryLike[]): MarginSummary | null {
  if (entries.length === 0) return null;
  const sum = (k: LedgerKind) => entries.filter((e) => e.kind === k).reduce((s, e) => s + minor(e.amount), 0);
  const cost = sum("SUPPLIER_COST");
  const markup = sum("MARKUP");
  const discount = -sum("DISCOUNT");
  const commission = sum("COMMISSION");
  return {
    currency: entries[0].currency,
    supplierCost: major(cost),
    markup: major(markup),
    discount: major(discount),
    tax: major(sum("TAX")),
    sellingTotal: major(sum("SELLING_TOTAL")),
    grossMargin: major(markup - discount),
    commission: major(commission),
    netMargin: major(markup - discount - commission),
  };
}

export interface StoredEntry extends EntryLike {
  id: string;
  reversesId: string | null;
}

/**
 * Drafts that cancel every entry not yet cancelled (same figures, opposite sign, pointing at the original).
 * Used when a quotation is withdrawn; the original rows stay as they were.
 */
export function reversalDrafts(entries: readonly (StoredEntry & { supplierKey?: string | null; label?: string | null; ruleId?: string | null; userId?: string | null })[]): (LedgerDraft & { reversesId: string })[] {
  const already = new Set(entries.map((e) => e.reversesId).filter((v): v is string => v !== null));
  return entries
    .filter((e) => e.reversesId === null && !already.has(e.id))
    .map((e) => ({
      kind: e.kind as LedgerKind,
      amount: -e.amount,
      currency: e.currency,
      supplierKey: e.supplierKey ?? null,
      label: e.label ? `Reversal: ${e.label}` : "Reversal",
      ruleId: e.ruleId ?? null,
      userId: e.userId ?? null,
      reversesId: e.id,
    }));
}
