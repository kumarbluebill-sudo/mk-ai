import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { runAgent, type AgentEvent } from "@/server/ai/agent";
import { generateFallbackResponse } from "@/server/ai/fallback";
import { getConfiguredProviders } from "@/server/ai/providers";
import { emptyState, type ConversationState } from "@/server/ai/tools";
import type { ChatMessage } from "@/server/ai/types";
import { assertFeature, assertWithinLimit } from "@/server/billing/limits";
import { rateLimit } from "@/server/rate-limit";
import { authErrorResponse, requireTenantContext, type TenantContext } from "@/server/tenant-context";

export const dynamic = "force-dynamic";

const bodySchema = z.object({
  conversationId: z.string().min(1).max(64).optional(),
  message: z.string().trim().min(1).max(4000),
});

const HISTORY_LIMIT = 30;

function parseState(raw: unknown): ConversationState {
  if (raw && typeof raw === "object" && !Array.isArray(raw)) {
    // bookingStatus is forced: nothing the model or stored JSON says can mark a trip booked.
    return { ...(raw as Partial<ConversationState>), bookingStatus: "NONE" };
  }
  return emptyState();
}

async function getCustomerId(ctx: TenantContext): Promise<string | null> {
  const customer = await ctx.db.customer.findFirst({ where: { userId: ctx.userId }, select: { id: true } });
  return customer?.id ?? null;
}

/** A conversation is only visible to the tenant AND the customer profile that owns it. */
async function findOwnConversation(ctx: TenantContext, id: string) {
  const customerId = await getCustomerId(ctx);
  if (!customerId) return null;
  return ctx.db.conversation.findFirst({ where: { id, customerId } });
}

export async function POST(request: NextRequest) {
  let ctx: TenantContext;
  try {
    ctx = await requireTenantContext("chat:use");
  } catch (error) {
    return authErrorResponse(error) ?? NextResponse.json({ error: "Failed to process chat" }, { status: 500 });
  }

  if (!(await rateLimit(`chat:${ctx.userId}`, 30, 60_000))) {
    return NextResponse.json({ error: "Too many messages. Please slow down." }, { status: 429 });
  }

  let json: unknown;
  try {
    json = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }
  const parsed = bodySchema.safeParse(json);
  if (!parsed.success) {
    return NextResponse.json({ error: "Invalid input", issues: parsed.error.issues }, { status: 400 });
  }
  const { message } = parsed.data;

  // Plan checks come before any work or cost: subscription state, AI feature, token budget, and (for a
  // brand-new conversation) the monthly conversation quota.
  try {
    await assertFeature(ctx, "ai");
    await assertWithinLimit(ctx, "aiTokens");
    if (!parsed.data.conversationId) await assertWithinLimit(ctx, "conversations");
  } catch (error) {
    return authErrorResponse(error) ?? NextResponse.json({ error: "Failed to process chat" }, { status: 500 });
  }

  // Resolve (or create) the conversation before streaming so errors map to proper status codes.
  let conversation;
  if (parsed.data.conversationId) {
    conversation = await findOwnConversation(ctx, parsed.data.conversationId);
    if (!conversation) return NextResponse.json({ error: "Conversation not found" }, { status: 404 });
  } else {
    const customerId = await getCustomerId(ctx);
    if (!customerId) return NextResponse.json({ error: "Customer profile not found" }, { status: 409 });
    conversation = await ctx.db.conversation.create({
      data: { tenantId: ctx.tenantId, customerId, title: message.slice(0, 60) },
    });
  }

  const previous = await ctx.db.message.findMany({
    where: { conversationId: conversation.id },
    orderBy: { createdAt: "desc" },
    take: HISTORY_LIMIT,
  });
  const history: ChatMessage[] = previous
    .reverse()
    .flatMap((m): ChatMessage[] =>
      m.role === "USER"
        ? [{ role: "user", content: m.content }]
        : m.role === "ASSISTANT"
          ? [{ role: "assistant", content: m.content }]
          : []
    );

  await ctx.db.message.create({
    data: { conversationId: conversation.id, userId: ctx.userId, role: "USER", content: message },
  });

  const conversationId = conversation.id;
  const state = parseState(conversation.state);
  const encoder = new TextEncoder();

  const stream = new ReadableStream({
    async start(controller) {
      const send = (event: Record<string, unknown>) => {
        try {
          controller.enqueue(encoder.encode(`data: ${JSON.stringify(event)}\n\n`));
        } catch {
          // Client disconnected.
        }
      };
      send({ type: "conversation", id: conversationId });

      try {
        const providers = getConfiguredProviders();
        let reply: string;
        let mode: "ai" | "scripted-fallback";

        if (providers.length === 0) {
          mode = "scripted-fallback";
          reply = generateFallbackResponse(message);
        } else {
          mode = "ai";
          const result = await runAgent({
            providers,
            ctx: { ...ctx, conversationId, state },
            history,
            userMessage: message,
            signal: request.signal,
            onEvent: (e: AgentEvent) => send(e),
          });
          reply = result.text || "Sorry, I couldn't produce a response. Please try again.";
        }

        await ctx.db.message.create({
          data: { conversationId, role: "ASSISTANT", content: reply, metadata: { mode } },
        });
        await ctx.db.conversation.update({
          where: { id: conversationId },
          data: { state: JSON.parse(JSON.stringify(state)) },
        });

        send({ type: "message", content: reply, mode, itinerary: state.itinerary ?? null });
      } catch (error) {
        if (!request.signal.aborted) {
          console.error("Chat error:", error);
          send({ type: "error", message: "Something went wrong while planning. Please try again." });
        }
      } finally {
        send({ type: "done" });
        try {
          controller.close();
        } catch {
          // Already closed.
        }
      }
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream; charset=utf-8",
      "Cache-Control": "no-cache, no-transform",
      Connection: "keep-alive",
    },
  });
}

export async function GET(request: NextRequest) {
  try {
    const ctx = await requireTenantContext("chat:use");
    const id = request.nextUrl.searchParams.get("id");

    if (!id) {
      const customerId = await getCustomerId(ctx);
      const conversations = customerId
        ? await ctx.db.conversation.findMany({
            where: { customerId, archived: false },
            orderBy: { updatedAt: "desc" },
            take: 30,
            select: { id: true, title: true, updatedAt: true },
          })
        : [];
      return NextResponse.json({ success: true, conversations });
    }

    const conversation = await findOwnConversation(ctx, id);
    if (!conversation) return NextResponse.json({ error: "Conversation not found" }, { status: 404 });

    const messages = await ctx.db.message.findMany({
      where: { conversationId: conversation.id },
      orderBy: { createdAt: "asc" },
      take: 100,
    });
    return NextResponse.json({
      success: true,
      conversationId: conversation.id,
      itinerary: parseState(conversation.state).itinerary ?? null,
      messages: messages.map((m) => ({ id: m.id, role: m.role, content: m.content, createdAt: m.createdAt })),
    });
  } catch (error) {
    const authResponse = authErrorResponse(error);
    if (authResponse) return authResponse;
    console.error("Chat history error:", error);
    return NextResponse.json({ error: "Failed to fetch chat history" }, { status: 500 });
  }
}
