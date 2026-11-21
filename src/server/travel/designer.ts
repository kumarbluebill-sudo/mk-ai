import type { Prisma } from "@/generated/prisma/client";
import { dayRoute, type DayRoute } from "./geo";
import {
  applyPatch,
  createItinerary,
  createItinerarySchema,
  patchSchema,
  type Itinerary,
  type ItineraryPatch,
} from "./itinerary";
import type { TenantContext } from "@/server/tenant-context";
import { z } from "zod";

/**
 * Itinerary designer persistence. The itinerary lives in Conversation.state.itinerary, so the AI
 * and the manual designer edit the same document. A conversation is visible only to its tenant AND
 * the customer profile that owns it (same rule as the chat API).
 */

export const designerPatchBody = z.object({
  patches: z.array(patchSchema).min(1).max(20),
});

export interface DesignerView {
  conversationId: string;
  title: string;
  itinerary: Itinerary | null;
  /** Straight-line ESTIMATES per day number, only for items that have coordinates. */
  routes: Record<number, DayRoute>;
}

function readItinerary(state: unknown): Itinerary | null {
  if (state && typeof state === "object" && !Array.isArray(state)) {
    const it = (state as { itinerary?: Itinerary }).itinerary;
    if (it && Array.isArray(it.days)) return it;
  }
  return null;
}

function routesFor(itinerary: Itinerary | null): Record<number, DayRoute> {
  const out: Record<number, DayRoute> = {};
  for (const d of itinerary?.days ?? []) out[d.dayNumber] = dayRoute(d.items);
  return out;
}

async function ownConversation(ctx: TenantContext, id: string) {
  const customer = await ctx.db.customer.findFirst({ where: { userId: ctx.userId }, select: { id: true } });
  if (!customer) return null;
  return ctx.db.conversation.findFirst({ where: { id, customerId: customer.id } });
}

export async function listDesignerItineraries(ctx: TenantContext) {
  const customer = await ctx.db.customer.findFirst({ where: { userId: ctx.userId }, select: { id: true } });
  if (!customer) return [];
  const rows = await ctx.db.conversation.findMany({
    where: { customerId: customer.id },
    orderBy: { updatedAt: "desc" },
    take: 50,
    select: { id: true, title: true, updatedAt: true, state: true },
  });
  return rows
    .map((r) => ({ r, it: readItinerary(r.state) }))
    .filter((x) => x.it !== null)
    .map(({ r, it }) => ({
      conversationId: r.id,
      title: it?.title ?? r.title ?? "Untitled trip",
      destination: it?.destination ?? "",
      days: it?.days.length ?? 0,
      updatedAt: r.updatedAt.toISOString(),
    }));
}

export async function getDesignerView(ctx: TenantContext, conversationId: string): Promise<DesignerView | null> {
  const convo = await ownConversation(ctx, conversationId);
  if (!convo) return null;
  const itinerary = readItinerary(convo.state);
  return { conversationId: convo.id, title: convo.title ?? "Untitled trip", itinerary, routes: routesFor(itinerary) };
}

export class NoItineraryError extends Error {
  constructor() {
    super("This conversation has no itinerary yet");
    this.name = "NoItineraryError";
  }
}

/** Applies all patches atomically in memory; if any throws (ItineraryError) nothing is saved. */
export async function applyDesignerPatches(
  ctx: TenantContext,
  conversationId: string,
  patches: ItineraryPatch[]
): Promise<DesignerView | null> {
  const convo = await ownConversation(ctx, conversationId);
  if (!convo) return null;
  const current = readItinerary(convo.state);
  if (!current) throw new NoItineraryError();

  let next = current;
  for (const p of patches) next = applyPatch(next, p);

  const state = { ...(convo.state as Record<string, unknown>), itinerary: next } as unknown as Prisma.InputJsonValue;
  // Scoped client forces tenantId; the id came from ownConversation so it belongs to this tenant.
  await ctx.db.conversation.update({ where: { id: convo.id }, data: { state } });
  return { conversationId: convo.id, title: convo.title ?? "Untitled trip", itinerary: next, routes: routesFor(next) };
}

export const blankTripBody = createItinerarySchema;

/** Creates a trip without the AI: a conversation whose state holds the new itinerary. */
export async function createManualItinerary(ctx: TenantContext, input: z.infer<typeof createItinerarySchema>) {
  const customer = await ctx.db.customer.findFirst({ where: { userId: ctx.userId }, select: { id: true } });
  if (!customer) return null;
  const itinerary = createItinerary(input);
  const state = { itinerary, bookingStatus: "NONE" } as unknown as Prisma.InputJsonValue;
  const convo = await ctx.db.conversation.create({
    data: { tenantId: ctx.tenantId, customerId: customer.id, title: itinerary.title.slice(0, 60), state },
  });
  return { conversationId: convo.id, itinerary };
}
