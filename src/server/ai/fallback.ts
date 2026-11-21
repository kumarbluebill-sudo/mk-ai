/**
 * Scripted keyword replies used ONLY when no AI provider is configured.
 * These are canned prompts, not travel intelligence: they never search or price anything.
 */
export function generateFallbackResponse(userMessage: string): string {
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
    return "👋 Hello! Welcome to MK AI Travel. I'm here to help you plan your perfect trip. Where would you like to go? The AI planner is not configured on this server yet, so I can only offer basic guidance for now.";
  }

  if (
    lowerMessage.includes("book") ||
    lowerMessage.includes("reserve") ||
    lowerMessage.includes("confirm")
  ) {
    return "Online booking is not enabled yet. Tell me about your trip and your agency can prepare an itinerary and quotation for you.";
  }

  if (lowerMessage.includes("help") || lowerMessage.includes("how")) {
    return "Of course! I can help you with:\n• Finding destinations\n• Searching activities & experiences\n• Checking prices and availability\n• Planning itineraries\n\nWhat would you like help with?";
  }

  // Default helpful response
  return `That sounds interesting! Could you tell me a bit more? For example:\n• Where are you thinking of traveling?\n• When would you like to go?\n• What kind of activities interest you?\n• What's your budget range?\n\nI'm here to help craft your perfect trip!`;
}
