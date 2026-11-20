import { NextRequest, NextResponse } from "next/server";
import { getPrismaClient } from "@/lib/prisma";

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { conversationId, message, userId } = body;

    if (!message) {
      return NextResponse.json(
        { error: "Message is required" },
        { status: 400 }
      );
    }

    const prisma = getPrismaClient();

    // Store user message
    await prisma.message.create({
      data: {
        conversationId: conversationId || "default",
        userId: userId || undefined,
        role: "USER" as any,
        content: message,
      },
    });

    // Generate AI response
    const aiResponse = await generateAIResponse(message);

    // Store AI response
    await prisma.message.create({
      data: {
        conversationId: conversationId || "default",
        role: "ASSISTANT" as any,
        content: aiResponse,
      },
    });

    return NextResponse.json({
      success: true,
      userMessage: message,
      aiResponse,
      conversationId,
    });
  } catch (error) {
    console.error("Chat error:", error);
    return NextResponse.json(
      {
        error: "Failed to process chat",
        message: error instanceof Error ? error.message : "Unknown error",
      },
      { status: 500 }
    );
  }
}

export async function GET(request: NextRequest) {
  try {
    const conversationId = request.nextUrl.searchParams.get("id") ?? "default";
    const prisma = getPrismaClient();

    const messages = await prisma.message.findMany({
      where: {
        conversationId,
      },
      orderBy: {
        createdAt: "asc",
      },
      take: 50,
    });

    return NextResponse.json({
      success: true,
      conversationId,
      messages: messages.map((msg) => ({
        id: msg.id,
        role: msg.role,
        content: msg.content,
        createdAt: msg.createdAt,
      })),
    });
  } catch (error) {
    console.error("Chat history error:", error);
    return NextResponse.json(
      {
        error: "Failed to fetch chat history",
        message: error instanceof Error ? error.message : "Unknown error",
      },
      { status: 500 }
    );
  }
}

async function generateAIResponse(userMessage: string): Promise<string> {
  // If OpenAI key is available, use it
  if (process.env.OPENAI_API_KEY) {
    return await generateOpenAIResponse(userMessage);
  }

  // Fallback: AI-like responses based on keywords
  return generateFallbackResponse(userMessage);
}

async function generateOpenAIResponse(userMessage: string): Promise<string> {
  try {
    const response = await fetch("https://api.openai.com/v1/chat/completions", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${process.env.OPENAI_API_KEY}`,
      },
      body: JSON.stringify({
        model: "gpt-3.5-turbo",
        messages: [
          {
            role: "system",
            content:
              "You are a helpful travel planning assistant for MK Solutions. Help users plan their trips with personalized recommendations.",
          },
          {
            role: "user",
            content: userMessage,
          },
        ],
        temperature: 0.7,
        max_tokens: 500,
      }),
    });

    if (!response.ok) {
      console.error("OpenAI error:", await response.text());
      return generateFallbackResponse(userMessage);
    }

    const data = await response.json();
    return (
      data.choices?.[0]?.message?.content ||
      generateFallbackResponse(userMessage)
    );
  } catch (error) {
    console.error("OpenAI API error:", error);
    return generateFallbackResponse(userMessage);
  }
}

function generateFallbackResponse(userMessage: string): string {
  const lowerMessage = userMessage.toLowerCase();

  // Travel planning responses
  if (
    lowerMessage.includes("where") ||
    lowerMessage.includes("destination")
  ) {
    return "Great question! Where are you thinking of traveling? I can help you explore destinations like Dubai, Bali, Kyoto, or suggest something based on your interests. What kind of experience are you looking for?";
  }

  if (lowerMessage.includes("when") || lowerMessage.includes("date")) {
    return "I'd love to help plan your dates! Are you thinking of a weekend getaway, a week-long adventure, or something longer? Just let me know your preferred travel dates.";
  }

  if (
    lowerMessage.includes("budget") ||
    lowerMessage.includes("price") ||
    lowerMessage.includes("cost")
  ) {
    return "Budget is important! I can help you find experiences that fit your budget. What's your approximate budget range? We have options from budget-friendly to luxury experiences.";
  }

  if (
    lowerMessage.includes("activity") ||
    lowerMessage.includes("things to do")
  ) {
    return "There are so many amazing activities! Are you interested in adventure, culture, relaxation, food experiences, or something else? Tell me more about what excites you!";
  }

  if (
    lowerMessage.includes("hello") ||
    lowerMessage.includes("hi") ||
    lowerMessage.includes("hey")
  ) {
    return "👋 Hello! Welcome to MK AI Travel. I'm here to help you plan your perfect trip. Where would you like to go? I can help with destination suggestions, activities, pricing, and bookings.";
  }

  if (
    lowerMessage.includes("book") ||
    lowerMessage.includes("reserve") ||
    lowerMessage.includes("confirm")
  ) {
    return "Ready to book? That's exciting! I can help you with the booking process. What would you like to book - an activity, hotel, or complete package?";
  }

  if (lowerMessage.includes("help") || lowerMessage.includes("how")) {
    return "Of course! I can help you with:\n• Finding destinations\n• Searching activities & experiences\n• Checking prices and availability\n• Planning itineraries\n• Making bookings\n\nWhat would you like help with?";
  }

  // Default helpful response
  return `That sounds interesting! Could you tell me a bit more? For example:\n• Where are you thinking of traveling?\n• When would you like to go?\n• What kind of activities interest you?\n• What's your budget range?\n\nI'm here to help craft your perfect trip!`;
}
