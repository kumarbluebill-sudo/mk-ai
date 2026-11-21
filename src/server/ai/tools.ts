import { z } from "zod";
import { getViatorClient } from "@/integrations/viator/client";
import { searchDestinations } from "@/lib/destinations";
import { can, type Action, type TenantRoleName } from "@/server/permissions";
import { recordAudit } from "@/server/audit";
import type { ScopedPrisma } from "@/server/tenant-scope";
import {
  applyPatch,
  createItinerary,
  createItinerarySchema,
  patchSchema,
  type Itinerary,
} from "@/server/travel/itinerary";
import { calculatePackagePrice, PricingError } from "@/server/travel/pricing";
import type { ToolSpec } from "./types";

/** Per-conversation working memory persisted in Conversation.state. */
export interface ConversationState {
  itinerary?: Itinerary;
  quotationId?: string;
  /** Always NONE until a real supplier confirmation exists. Nothing in this module can change it. */
  bookingStatus: "NONE";
}

export function emptyState(): ConversationState {
  return { bookingStatus: "NONE" };
}

export interface ToolContext {
  tenantId: string;
  userId: string;
  role: TenantRoleName;
  conversationId: string;
  db: ScopedPrisma;
  /** Mutable; the agent persists it after each run. */
  state: ConversationState;
}

interface ToolDefinition {
  name: string;
  description: string;
  schema: z.ZodType;
  requires?: Action;
  execute(input: never, ctx: ToolContext): Promise<unknown>;
}

function define<S extends z.ZodType>(def: {
  name: string;
  description: string;
  schema: S;
  requires?: Action;
  execute: (input: z.infer<S>, ctx: ToolContext) => Promise<unknown>;
}): ToolDefinition {
  return def as unknown as ToolDefinition;
}

const currencySchema = z.string().length(3).toUpperCase();
const dateSchema = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Use YYYY-MM-DD");

/** Viator failures (missing key, upstream error) are returned to the model as data, never faked. */
async function viatorCall<T>(fn: (client: ReturnType<typeof getViatorClient>) => Promise<T>) {
  let client: ReturnType<typeof getViatorClient>;
  try {
    client = getViatorClient();
  } catch (error) {
    return { ok: false as const, error: "SUPPLIER_NOT_CONFIGURED", detail: error instanceof Error ? error.message : "" };
  }
  try {
    return { ok: true as const, data: await fn(client), environment: client.getEnvironment() };
  } catch (error) {
    return { ok: false as const, error: "SUPPLIER_ERROR", detail: error instanceof Error ? error.message : "" };
  }
}

function notConfigured(name: string, requirement: string): ToolDefinition {
  return define({
    name,
    description: `NOT AVAILABLE: ${requirement}. Calling it returns an error; never invent results for this capability.`,
    schema: z.object({}).passthrough(),
    execute: async () => ({
      error: "NOT_CONFIGURED",
      message: `${name} is not available yet. ${requirement}. Tell the user this honestly; do not invent data.`,
    }),
  });
}

export const TOOLS: ToolDefinition[] = [
  define({
    name: "extract_travel_requirements",
    description:
      "Save/merge the traveller's requirements (only fields stated by the user). Returns what is still missing so you can ask about it.",
    schema: z.object({
      origin: z.string().max(120).optional(),
      destination: z.string().max(120).optional(),
      startDate: dateSchema.optional(),
      endDate: dateSchema.optional(),
      adults: z.number().int().min(1).max(30).optional(),
      children: z.number().int().min(0).max(30).optional(),
      childAges: z.array(z.number().int().min(0).max(17)).max(30).optional(),
      budget: z.number().positive().optional(),
      currency: currencySchema.optional(),
      preferences: z.array(z.string().max(80)).max(20).optional(),
    }),
    execute: async (input, ctx) => {
      const data = {
        ...(input.origin !== undefined && { origin: input.origin }),
        ...(input.destination !== undefined && { destination: input.destination }),
        ...(input.startDate !== undefined && { startDate: new Date(input.startDate) }),
        ...(input.endDate !== undefined && { endDate: new Date(input.endDate) }),
        ...(input.adults !== undefined && { adults: input.adults }),
        ...(input.children !== undefined && { children: input.children }),
        ...(input.childAges !== undefined && { childAges: input.childAges }),
        ...(input.budget !== undefined && { budget: input.budget }),
        ...(input.currency !== undefined && { currency: input.currency }),
        ...(input.preferences !== undefined && { preferences: input.preferences }),
      };
      const saved = await ctx.db.travelRequirements.upsert({
        where: { conversationId: ctx.conversationId },
        create: { conversationId: ctx.conversationId, ...data },
        update: data,
      });
      const missing: string[] = [];
      if (!saved.destination) missing.push("destination");
      if (!saved.startDate || !saved.endDate) missing.push("travel dates");
      if (!saved.budget) missing.push("budget");
      return {
        saved: {
          origin: saved.origin,
          destination: saved.destination,
          startDate: saved.startDate?.toISOString().slice(0, 10) ?? null,
          endDate: saved.endDate?.toISOString().slice(0, 10) ?? null,
          adults: saved.adults,
          children: saved.children,
          childAges: saved.childAges,
          budget: saved.budget ? Number(saved.budget) : null,
          currency: saved.currency,
          preferences: saved.preferences,
        },
        missing,
      };
    },
  }),

  define({
    name: "search_destinations",
    description:
      "Search the editorial destination catalogue. Content and 'startingAt' prices are illustrative, NOT live supplier inventory.",
    schema: z.object({ query: z.string().max(100).default("") }),
    execute: async ({ query }) => ({
      source: "editorial-catalogue",
      liveInventory: false,
      destinations: searchDestinations(query),
    }),
  }),

  define({
    name: "search_activities",
    description:
      "Search live Viator activities/tours by keyword (include the city, e.g. 'Dubai desert safari'). Prices come from the supplier; check 'liveInventory' and 'environment' before calling them live.",
    schema: z.object({
      keyword: z.string().min(2).max(200),
      startDate: dateSchema.optional(),
      currency: z.enum(["USD", "EUR", "GBP", "AUD", "CAD"]).default("USD"),
    }),
    execute: async (input) => {
      const r = await viatorCall((c) => c.searchActivities(input));
      if (!r.ok) return r;
      return {
        source: "VIATOR",
        environment: r.environment,
        // Sandbox data is test data, not sellable live inventory.
        liveInventory: r.environment === "production",
        checkedAt: new Date().toISOString(),
        totalCount: r.data.totalCount,
        activities: r.data.activities.slice(0, 10),
      };
    },
  }),

  define({
    name: "get_product_details",
    description: "Get details of one Viator product by its product code.",
    schema: z.object({ productCode: z.string().min(1).max(100) }),
    execute: async ({ productCode }) => {
      const r = await viatorCall((c) => c.getActivityDetails(productCode));
      if (!r.ok) return r;
      return { source: "VIATOR", environment: r.environment, activity: r.data };
    },
  }),

  define({
    name: "check_availability",
    description:
      "Check live Viator availability and price for a product on a date. Use before presenting a price as current.",
    schema: z.object({
      productCode: z.string().min(1).max(100),
      date: dateSchema,
      adults: z.number().int().min(1).max(15),
      children: z.number().int().min(0).max(14).default(0),
      currency: z.enum(["USD", "EUR", "GBP", "AUD", "CAD"]).default("USD"),
      productOptionCode: z.string().max(100).optional(),
    }),
    execute: async (i) => {
      const r = await viatorCall((c) =>
        c.checkAvailability(i.productCode, i.date, { adults: i.adults, children: i.children }, i.currency, i.productOptionCode)
      );
      if (!r.ok) return r;
      return {
        source: "VIATOR",
        environment: r.environment,
        liveInventory: r.environment === "production",
        checkedAt: new Date().toISOString(),
        activity: { id: r.data.activity.id, title: r.data.activity.title },
        currency: r.data.availability.currency,
        bookableItems: r.data.availability.bookableItems.map((b) => ({
          productOptionCode: b.productOptionCode,
          startTime: b.startTime,
          available: b.available,
          price: b.totalPrice?.price?.recommendedRetailPrice ?? null,
        })),
      };
    },
  }),

  define({
    name: "calculate_package_price",
    description:
      "Calculate package price from cost lines using the agency's configured markup. Single currency only; no conversion is performed.",
    schema: z.object({
      lines: z
        .array(
          z.object({
            name: z.string().min(1).max(200),
            unitCost: z.number().min(0),
            quantity: z.number().int().min(1).default(1),
            currency: currencySchema,
          })
        )
        .min(1)
        .max(100),
      taxPercent: z.number().min(0).max(100).default(0),
      discount: z.number().min(0).default(0),
    }),
    execute: async (input, ctx) => {
      const markupRow = await ctx.db.markupSetting.findFirst({ where: { active: true, supplierId: null } });
      try {
        const r = calculatePackagePrice({
          lines: input.lines,
          taxPercent: input.taxPercent,
          discount: input.discount,
          markup: markupRow
            ? {
                percentage: markupRow.percentage ? Number(markupRow.percentage) : undefined,
                fixedAmount: markupRow.fixedAmount ? Number(markupRow.fixedAmount) : undefined,
              }
            : undefined,
        });
        // Internal cost and margin are only visible to roles allowed to see them.
        if (!can(ctx.role, "cost:view")) {
          return { currency: r.currency, discount: r.discount, taxes: r.taxes, total: r.total };
        }
        return r;
      } catch (error) {
        if (error instanceof PricingError) return { error: "PRICING_ERROR", message: error.message };
        throw error;
      }
    },
  }),

  define({
    name: "create_itinerary",
    description:
      "Create a new day-wise itinerary (replaces any current one). Mark each item's status honestly: LIVE only if it came from check_availability, ESTIMATE for rough prices, otherwise UNVERIFIED.",
    schema: createItinerarySchema,
    requires: "itinerary:write",
    execute: async (input, ctx) => {
      ctx.state.itinerary = createItinerary(input);
      return { itinerary: ctx.state.itinerary };
    },
  }),

  define({
    name: "modify_itinerary",
    description:
      "Apply targeted edits (add/remove/replace item, rename day, add/remove day) to the current itinerary. Only the named parts change.",
    schema: z.object({ patches: z.array(patchSchema).min(1).max(10) }),
    requires: "itinerary:write",
    execute: async ({ patches }, ctx) => {
      if (!ctx.state.itinerary) return { error: "NO_ITINERARY", message: "Create an itinerary first." };
      let next = ctx.state.itinerary;
      for (const p of patches) next = applyPatch(next, p); // throws ItineraryError, leaving state untouched
      ctx.state.itinerary = next;
      return { itinerary: next };
    },
  }),

  define({
    name: "create_quotation",
    description:
      "Save the current itinerary and a DRAFT quotation priced from items that have a price. Does not book anything.",
    schema: z.object({
      taxPercent: z.number().min(0).max(100).default(0),
      discount: z.number().min(0).default(0),
    }),
    requires: "quotation:write",
    execute: async (input, ctx) => {
      const itinerary = ctx.state.itinerary;
      if (!itinerary) return { error: "NO_ITINERARY", message: "Create an itinerary first." };

      const priced = itinerary.days.flatMap((d) =>
        d.items.filter((i) => i.price !== undefined && i.currency).map((i) => ({ day: d.dayNumber, item: i }))
      );
      if (priced.length === 0) return { error: "NOTHING_PRICED", message: "No itinerary item has a price yet." };

      const markupRow = await ctx.db.markupSetting.findFirst({ where: { active: true, supplierId: null } });
      let price;
      try {
        price = calculatePackagePrice({
          lines: priced.map(({ item }) => ({
            name: item.title,
            unitCost: item.price as number,
            quantity: 1,
            currency: item.currency as string,
          })),
          taxPercent: input.taxPercent,
          discount: input.discount,
          markup: markupRow
            ? {
                percentage: markupRow.percentage ? Number(markupRow.percentage) : undefined,
                fixedAmount: markupRow.fixedAmount ? Number(markupRow.fixedAmount) : undefined,
              }
            : undefined,
        });
      } catch (error) {
        if (error instanceof PricingError) return { error: "PRICING_ERROR", message: error.message };
        throw error;
      }

      const customer = await ctx.db.customer.findFirst({ where: { userId: ctx.userId } });
      if (!customer) return { error: "NO_CUSTOMER_PROFILE" };

      const unpriced = itinerary.days.flatMap((d) => d.items.filter((i) => i.price === undefined).map((i) => i.title));
      const unverified = priced.filter(({ item }) => item.status !== "LIVE").map(({ item }) => item.title);
      const reference = `QT-${Date.now()}-${Math.random().toString(36).slice(2, 8).toUpperCase()}`;

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
        return tx.quotation.create({
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
            validUntil: new Date(Date.now() + 3 * 24 * 60 * 60 * 1000),
          },
        });
      });

      ctx.state.quotationId = quotation.id;
      void recordAudit({ tenantId: ctx.tenantId, userId: ctx.userId, action: "quotation.created", entity: "Quotation", entityId: quotation.id, metadata: { reference } });
      const view = { reference, currency: price.currency, taxes: price.taxes, discount: price.discount, total: price.total };
      return {
        quotation: can(ctx.role, "cost:view") ? { ...view, subtotal: price.subtotal, markup: price.markup } : view,
        status: "DRAFT",
        warnings: {
          unpricedItems: unpriced,
          itemsNotVerifiedLive: unverified,
          note: "Prices are not confirmed until live availability is re-checked. Nothing has been booked.",
        },
      };
    },
  }),

  notConfigured("search_hotels", "No hotel supplier (e.g. Yatra, Hotelbeds) is connected; official API access is required"),
  notConfigured("search_flights", "No flight supplier (e.g. Amadeus, Yatra) is connected; official API access is required"),
  notConfigured("search_transfers", "No transfer supplier is connected; official API access is required"),
  notConfigured("compare_inventory", "Requires more than one connected supplier"),
  notConfigured("optimize_itinerary", "Requires a maps/routing provider for real distances and travel times"),
  notConfigured("verify_inventory", "Use check_availability for Viator products; no other supplier is connected"),
  notConfigured("create_booking", "Supplier reservations and payment are not enabled yet; nothing can be booked"),
  notConfigured("check_booking_status", "No bookings can be created yet"),
  notConfigured("process_payment", "Payment gateway (Razorpay) is not configured"),
  notConfigured("generate_voucher", "Vouchers can only be generated after a real supplier confirmation"),
  notConfigured("send_travel_documents", "Email/WhatsApp delivery and PDF generation are not configured"),
];

const byName = new Map(TOOLS.map((t) => [t.name, t]));

export function getToolSpecs(): ToolSpec[] {
  return TOOLS.map((t) => {
    const { $schema: _ignored, ...schema } = z.toJSONSchema(t.schema) as Record<string, unknown>;
    void _ignored;
    return { name: t.name, description: t.description, inputSchema: schema };
  });
}

export type ToolResult = { ok: true; result: unknown } | { ok: false; error: string };

const MAX_RESULT_CHARS = 20_000;

export function serializeResult(value: unknown): string {
  const text = JSON.stringify(value);
  return text.length > MAX_RESULT_CHARS ? `${text.slice(0, MAX_RESULT_CHARS)}…[truncated]` : text;
}

/** Validates input, enforces role permissions and executes one tool. Never throws. */
export async function executeTool(name: string, rawInput: unknown, ctx: ToolContext): Promise<ToolResult> {
  const tool = byName.get(name);
  if (!tool) return { ok: false, error: `Unknown tool: ${name}` };
  if (tool.requires && !can(ctx.role, tool.requires)) {
    return { ok: false, error: `Your role does not permit ${name}` };
  }
  const parsed = tool.schema.safeParse(rawInput);
  if (!parsed.success) {
    return { ok: false, error: `Invalid input: ${parsed.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`).join("; ")}` };
  }
  try {
    return { ok: true, result: await tool.execute(parsed.data as never, ctx) };
  } catch (error) {
    console.error(`Tool ${name} failed:`, error);
    return { ok: false, error: error instanceof Error ? error.message : "Tool failed" };
  }
}
