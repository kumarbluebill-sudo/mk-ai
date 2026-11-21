import { z } from "zod";
import { createQuotation, QuotationError, quoteOptionsSchema, visiblePrice } from "@/server/quotation/service";
import { getTravelDeskClient, TravelDeskError } from "@/integrations/traveldesk/client";
import { checkTravelDeskAvailability } from "@/server/suppliers/traveldesk-availability";
import { searchInventory } from "@/server/suppliers/search";
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
      "Search activities/tours across all connected suppliers (Viator, Traveldesk for the UAE) by keyword (include the city, e.g. 'Dubai desert safari'). Each result has a supplier and id; pass them to check_availability. Prices come from the suppliers; 'liveInventory' false or dataStatus SANDBOX means test data, never call it live.",
    schema: z.object({
      keyword: z.string().min(2).max(200),
      startDate: dateSchema.optional(),
      currency: z.enum(["USD", "EUR", "GBP", "AUD", "CAD"]).default("USD"),
      sort: z.enum(["relevance", "price", "rating"]).default("relevance"),
      maxPricePerPerson: z.number().positive().optional(),
    }),
    execute: async (input) => {
      // All configured activity suppliers are queried in parallel; each supplier's status is reported.
      const result = await searchInventory(
        { category: "activity", keyword: input.keyword, startDate: input.startDate, currency: input.currency, limit: 10 },
        {
          sort: input.sort,
          maxPriceMinor: input.maxPricePerPerson ? Math.round(input.maxPricePerPerson * 100) : undefined,
        }
      );
      const anyConfigured = result.suppliers.some((s) => s.status !== "NOT_CONFIGURED" && s.status !== "UNSUPPORTED");
      if (!anyConfigured) {
        return { ok: false, error: "SUPPLIER_NOT_CONFIGURED", suppliers: result.suppliers };
      }
      if (result.suppliers.every((s) => s.status !== "OK")) {
        return { ok: false, error: "SUPPLIER_ERROR", suppliers: result.suppliers };
      }
      return {
        checkedAt: result.checkedAt,
        // True only when items came from a production supplier API; sandbox items are labelled SANDBOX.
        liveInventory: result.liveInventory,
        suppliers: result.suppliers,
        activities: result.items.map((i) => ({
          supplier: i.supplier,
          id: i.supplierItemId,
          title: i.title,
          description: i.description.slice(0, 300),
          pricePerPerson: i.price && i.price.basis === "FROM_PER_PERSON" ? i.price.amountMinor / 100 : null,
          currency: i.price?.currency ?? null,
          duration: i.duration ?? null,
          rating: i.rating ?? null,
          reviews: i.reviewCount ?? null,
          dataStatus: i.dataStatus,
        })),
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
      "Check live availability and price for a product on a date. Set supplier to the item's supplier from search_activities (viator or traveldesk). For traveldesk, productCode is the tour id and productOptionCode (optional) is an offer id. Use before presenting a price as current. Results with liveInventory=false are test data.",
    schema: z.object({
      supplier: z.enum(["viator", "traveldesk"]).default("viator"),
      productCode: z.string().min(1).max(100),
      date: dateSchema,
      adults: z.number().int().min(1).max(15),
      children: z.number().int().min(0).max(14).default(0),
      currency: z.enum(["USD", "EUR", "GBP", "AUD", "CAD"]).default("USD"),
      productOptionCode: z.string().max(100).optional(),
    }),
    execute: async (i) => {
      if (i.supplier === "traveldesk") {
        const tourId = Number(i.productCode);
        const offerId = i.productOptionCode ? Number(i.productOptionCode) : undefined;
        if (!Number.isInteger(tourId) || (offerId !== undefined && !Number.isInteger(offerId))) {
          return { ok: false, error: "INVALID_PRODUCT_CODE", detail: "Traveldesk tour and offer ids are numbers." };
        }
        let client;
        try {
          client = getTravelDeskClient();
        } catch (error) {
          return { ok: false, error: "SUPPLIER_NOT_CONFIGURED", detail: error instanceof Error ? error.message : "" };
        }
        try {
          const a = await checkTravelDeskAvailability(client, { tourId, date: i.date, adults: i.adults, children: i.children, offerId });
          return {
            source: "TRAVELDESK",
            liveInventory: a.environment === "production",
            ...a,
            note: "Totals are computed from the supplier's unit prices. Currency is USD. Nothing has been reserved.",
          };
        } catch (error) {
          return { ok: false, error: "SUPPLIER_ERROR", detail: error instanceof TravelDeskError ? error.message : "Traveldesk request failed" };
        }
      }
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
      "Save the current itinerary and a DRAFT quotation priced from items that have a price. Does not book anything. For Indian GST pass gst {ratePercent, supply: INTRA_STATE|INTER_STATE}; only use a rate the user gave you.",
    schema: quoteOptionsSchema,
    requires: "quotation:write",
    execute: async (input, ctx) => {
      const itinerary = ctx.state.itinerary;
      if (!itinerary) return { error: "NO_ITINERARY", message: "Create an itinerary first." };
      try {
        const q = await createQuotation(ctx, itinerary, input);
        ctx.state.quotationId = q.id;
        return {
          quotation: { reference: q.reference, validUntil: q.validUntil, ...visiblePrice(ctx, q.price) },
          status: "DRAFT",
          warnings: q.warnings,
        };
      } catch (error) {
        if (error instanceof QuotationError) return { error: error.code, message: error.message };
        throw error;
      }
    },
  }),

  notConfigured("search_hotels", "No hotel supplier (e.g. Yatra, Hotelbeds) is connected; official API access is required"),
  notConfigured("search_flights", "No flight supplier (e.g. Amadeus, Yatra) is connected; official API access is required"),
  notConfigured("search_transfers", "No transfer supplier is connected; official API access is required"),
  notConfigured("compare_inventory", "Requires more than one connected supplier"),
  notConfigured("optimize_itinerary", "Requires a maps/routing provider for real distances and travel times"),
  notConfigured("verify_inventory", "Use check_availability for Viator products; no other supplier is connected"),
  notConfigured("create_booking", "The assistant cannot reserve, confirm or cancel bookings. A person makes Traveldesk test bookings on the Bookings screen; tell the user to open it"),
  notConfigured("check_booking_status", "Booking status is shown on the Bookings screen, not through the assistant"),
  notConfigured("process_payment", "Payment gateway (Razorpay) is not configured"),
  notConfigured("generate_voucher", "Vouchers are the supplier's own PDFs, downloaded by a person from a confirmed booking on the Bookings screen"),
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
