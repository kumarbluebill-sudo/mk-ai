import { z } from "zod";
import type { Prisma } from "@/generated/prisma/client";
import { recordAudit } from "@/server/audit";
import { assertWithinLimit } from "@/server/billing/limits";
import { can } from "@/server/permissions";
import type { TenantContext } from "@/server/tenant-context";
import type { Itinerary } from "@/server/travel/itinerary";
import { marginSummary, quotationLedgerDrafts, type CommissionInput, type LedgerDraft, type LineAttribution } from "@/server/pricing/ledger";
import { productTypeOf, selectCommissionRule, selectMarkupRule } from "@/server/pricing/rules";
import { toRule } from "@/server/pricing/service";
import { calculatePackagePrice, PricingError, type PriceBreakdown } from "@/server/travel/pricing";
import { buildQuoteDocument, type QuoteDocument } from "./document";
import { renderQuotePdf } from "./pdf";

export const quoteOptionsSchema = z
  .object({
    /** Plain single-rate tax. Use `gst` for the CGST/SGST/IGST split. */
    taxPercent: z.number().min(0).max(100).optional(),
    gst: z
      .object({ ratePercent: z.number().min(0).max(100), supply: z.enum(["INTRA_STATE", "INTER_STATE"]) })
      .optional(),
    discount: z.number().min(0).default(0),
    validDays: z.number().int().min(1).max(60).default(3),
  })
  .refine((o) => !(o.gst && o.taxPercent), { message: "Use either taxPercent or gst, not both" });

export type QuoteOptions = z.infer<typeof quoteOptionsSchema>;

export class QuotationError extends Error {
  constructor(
    readonly code: "NO_CUSTOMER_PROFILE" | "NOTHING_PRICED" | "PRICING_ERROR" | "NOT_FOUND" | "NO_SNAPSHOT",
    message: string
  ) {
    super(message);
    this.name = "QuotationError";
  }
}

async function ownCustomer(ctx: TenantContext) {
  return ctx.db.customer.findFirst({
    where: { userId: ctx.userId },
    select: { id: true, user: { select: { name: true, email: true } } },
  });
}

/** What the caller may see of the price: cost and markup only for roles with cost:view. */
export function visiblePrice(ctx: TenantContext, price: PriceBreakdown) {
  const base = { currency: price.currency, taxable: price.taxable, taxLines: price.taxLines, taxes: price.taxes, discount: price.discount, total: price.total };
  return can(ctx.role, "cost:view") ? { ...base, subtotal: price.subtotal, markup: price.markup } : base;
}

export async function createQuotation(ctx: TenantContext, itinerary: Itinerary, options: QuoteOptions) {
  await assertWithinLimit(ctx, "quotations");
  const priced = itinerary.days.flatMap((d) =>
    d.items.filter((i) => i.price !== undefined && i.currency).map((i) => ({ day: d.dayNumber, item: i }))
  );
  if (priced.length === 0) throw new QuotationError("NOTHING_PRICED", "No itinerary item has a price yet.");

  const customer = await ownCustomer(ctx);
  if (!customer) throw new QuotationError("NO_CUSTOMER_PROFILE", "Customer profile not found.");

  // One markup rule per line (the most specific one that matches); see src/server/pricing/rules.ts.
  const rules = (await ctx.db.markupSetting.findMany({ where: { active: true }, take: 200 })).map(toRule);
  const attributions: LineAttribution[] = [];
  let price: PriceBreakdown;
  try {
    price = calculatePackagePrice({
      lines: priced.map(({ item }) => {
        const supplierKey = item.supplier ? item.supplier.toLowerCase() : null;
        const rule = selectMarkupRule(rules, { supplierKey, productType: productTypeOf(item.category), destination: itinerary.destination, customerId: customer.id, currency: item.currency as string });
        attributions.push({ supplierKey, ruleId: rule?.id ?? null });
        return {
          name: item.title,
          unitCost: item.price as number,
          quantity: 1,
          currency: item.currency as string,
          markup: rule ? { percentage: rule.percentage ?? undefined, fixedAmount: rule.fixedAmount ?? undefined } : undefined,
        };
      }),
      taxPercent: options.taxPercent,
      gst: options.gst,
      discount: options.discount,
    });
  } catch (error) {
    if (error instanceof PricingError) throw new QuotationError("PRICING_ERROR", error.message);
    throw error;
  }

  const commissionRule = selectCommissionRule(rules, ctx.userId);
  const commission: CommissionInput | undefined = commissionRule ? { userId: ctx.userId, ruleId: commissionRule.id, percentage: commissionRule.percentage as number } : undefined;
  const ledger: LedgerDraft[] = quotationLedgerDrafts(price, attributions, commission);
  const company = await ctx.db.companySettings.findFirst();

  const issuedAt = new Date();
  const validUntil = new Date(issuedAt.getTime() + options.validDays * 24 * 60 * 60 * 1000);
  const reference = `QT-${issuedAt.getTime()}-${Math.random().toString(36).slice(2, 8).toUpperCase()}`;

  const document = buildQuoteDocument({
    reference,
    issuedAt,
    validUntil,
    company: {
      name: company?.name ?? "Travel agency",
      address: company?.address ?? undefined,
      phone: company?.phone ?? undefined,
      email: company?.email ?? undefined,
      website: company?.website ?? undefined,
      gstNumber: company?.gstNumber ?? undefined,
      terms: company?.terms ?? undefined,
    },
    customerName: customer.user.name ?? customer.user.email,
    itinerary,
    price,
  });

  const unpriced = itinerary.days.flatMap((d) => d.items.filter((i) => i.price === undefined).map((i) => i.title));
  const unverified = priced.filter(({ item }) => item.status !== "LIVE").map(({ item }) => item.title);

  const quotation = await ctx.db.$transaction(async (tx) => {
    const saved = await tx.itinerary.create({
      data: {
        tenantId: ctx.tenantId,
        customerId: customer.id,
        title: itinerary.title,
        startDate: itinerary.startDate ? new Date(itinerary.startDate) : undefined,
        status: "DRAFT",
        days: {
          create: itinerary.days.map((d) => ({
            dayNumber: d.dayNumber,
            date: d.date ? new Date(d.date) : undefined,
            title: d.title,
            items: {
              create: d.items.map((i, idx) => ({
                title: i.title,
                description: i.description,
                startTime: i.startTime,
                endTime: i.endTime,
                location: i.location,
                sortOrder: idx,
                supplierName: i.supplier,
                liveStatus: i.status === "LIVE" ? ("AVAILABLE" as const) : ("DEMO" as const),
                price: i.price,
                currency: i.currency ?? price.currency,
                metadata: { category: i.category, productCode: i.productCode ?? null },
              })),
            },
          })),
        },
      },
    });
    const created = await tx.quotation.create({
      data: {
        tenantId: ctx.tenantId,
        customerId: customer.id,
        itineraryId: saved.id,
        reference,
        status: "DRAFT",
        currency: price.currency,
        subtotal: price.subtotal,
        markup: price.markup,
        taxes: price.taxes,
        discount: price.discount,
        total: price.total,
        validUntil,
        snapshot: document as unknown as Prisma.InputJsonValue,
      },
    });
    // The financial history of this quotation, written in the same transaction so the two can never disagree.
    await tx.ledgerEntry.createMany({
      data: ledger.map((d) => ({
        tenantId: ctx.tenantId,
        quotationId: created.id,
        kind: d.kind,
        amount: d.amount,
        currency: d.currency,
        supplierKey: d.supplierKey ?? null,
        label: d.label ?? null,
        ruleId: d.ruleId ?? null,
        userId: d.userId ?? null,
      })),
    });
    return created;
  });

  void recordAudit({ tenantId: ctx.tenantId, userId: ctx.userId, action: "quotation.created", entity: "Quotation", entityId: quotation.id, metadata: { reference } });

  return {
    id: quotation.id,
    reference,
    validUntil: document.validUntil,
    price,
    /** Supplier cost, markup, commission and margin. Only for roles with cost:view; the route removes it for others. */
    margin: marginSummary(ledger),
    document,
    warnings: {
      unpricedItems: unpriced,
      itemsNotVerifiedLive: unverified,
      note: "Prices are not confirmed until live availability is re-checked. Nothing has been booked.",
    },
  };
}

export async function listQuotations(ctx: TenantContext) {
  const customer = await ownCustomer(ctx);
  if (!customer) return [];
  const rows = await ctx.db.quotation.findMany({
    where: { customerId: customer.id },
    orderBy: { createdAt: "desc" },
    take: 50,
    select: { id: true, reference: true, status: true, currency: true, total: true, validUntil: true, createdAt: true },
  });
  return rows.map((r) => ({
    id: r.id,
    reference: r.reference,
    status: r.status,
    currency: r.currency,
    total: Number(r.total),
    validUntil: r.validUntil?.toISOString().slice(0, 10) ?? null,
    createdAt: r.createdAt.toISOString(),
  }));
}

/** Renders the stored snapshot; a quotation is only visible to its tenant and owning customer. */
export async function getQuotationPdf(ctx: TenantContext, id: string): Promise<{ reference: string; bytes: Uint8Array }> {
  const customer = await ownCustomer(ctx);
  const row = customer ? await ctx.db.quotation.findFirst({ where: { id, customerId: customer.id } }) : null;
  if (!row) throw new QuotationError("NOT_FOUND", "Quotation not found");
  if (!row.snapshot) throw new QuotationError("NO_SNAPSHOT", "This quotation predates PDF support and has no stored document.");
  const bytes = await renderQuotePdf(row.snapshot as unknown as QuoteDocument);
  void recordAudit({ tenantId: ctx.tenantId, userId: ctx.userId, action: "quotation.pdf_downloaded", entity: "Quotation", entityId: row.id });
  return { reference: row.reference, bytes };
}
