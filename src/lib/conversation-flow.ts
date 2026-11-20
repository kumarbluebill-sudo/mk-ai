/**
 * Conversational Flow for Travel Planning
 * Guides users through structured questions to build an itinerary
 */

export type ConversationStage =
  | "destination"
  | "travelers"
  | "dates"
  | "trip_type"
  | "activities"
  | "accommodation"
  | "transport"
  | "summary";

export interface ConversationState {
  stage: ConversationStage;
  destination?: string;
  travelers?: { adults: number; children: number; childAges?: number[] };
  startDate?: string;
  endDate?: string;
  tripType?: "private" | "customized" | "group";
  activities?: string[];
  accommodation?: string;
  transport?: "private" | "public" | "both";
  budget?: number;
  currency?: string;
}

export function getNextQuestion(state: ConversationState): string {
  switch (state.stage) {
    case "destination":
      return "Where would you like to go? (e.g., Bali, Dubai, Kyoto)";

    case "travelers":
      return `Perfect! How many people are traveling? (Adults & children)`;

    case "dates":
      return "When are you planning to travel? (Start and end dates)";

    case "trip_type":
      return "What type of experience? (1) Private & personalized (2) Customized itinerary (3) Group tour";

    case "activities":
      return "What activities interest you? (e.g., adventure, culture, relaxation, food)";

    case "accommodation":
      return "Any preference for accommodation? (Budget, Mid-range, Luxury)";

    case "transport":
      return "How would you like to travel between locations? (Private transfers, Public, Flexible)";

    case "summary":
      return "Perfect! Let me create your itinerary and package...";

    default:
      return "What would you like to do next?";
  }
}

export function parseUserResponse(
  userInput: string,
  currentStage: ConversationStage
): Partial<ConversationState> {
  const input = userInput.toLowerCase().trim();

  switch (currentStage) {
    case "destination":
      return { destination: extractDestination(input) };

    case "travelers":
      return extractTravelers(input);

    case "dates":
      return extractDates(input);

    case "trip_type":
      return {
        tripType: input.includes("private")
          ? "private"
          : input.includes("customized")
            ? "customized"
            : input.includes("group")
              ? "group"
              : undefined,
      };

    case "activities":
      return { activities: extractActivities(input) };

    case "accommodation":
      return {
        accommodation: input.includes("luxury")
          ? "luxury"
          : input.includes("budget")
            ? "budget"
            : "midrange",
      };

    case "transport":
      return {
        transport: input.includes("private")
          ? "private"
          : input.includes("public")
            ? "public"
            : "both",
      };

    default:
      return {};
  }
}

export function getNextStage(currentStage: ConversationStage): ConversationStage {
  const stages: ConversationStage[] = [
    "destination",
    "travelers",
    "dates",
    "trip_type",
    "activities",
    "accommodation",
    "transport",
    "summary",
  ];

  const currentIndex = stages.indexOf(currentStage);
  return stages[currentIndex + 1] || "summary";
}

export function isConversationComplete(state: ConversationState): boolean {
  return !!(
    state.destination &&
    state.travelers &&
    state.startDate &&
    state.endDate &&
    state.tripType &&
    state.activities &&
    state.activities.length > 0
  );
}

// Helper functions
function extractDestination(input: string): string {
  const destinations = [
    "dubai",
    "bali",
    "kyoto",
    "paris",
    "tokyo",
    "thailand",
    "maldives",
    "switzerland",
    "spain",
    "italy",
  ];

  for (const dest of destinations) {
    if (input.includes(dest)) return dest;
  }

  return input.split(",")[0].trim();
}

function extractTravelers(
  input: string
): Partial<ConversationState> {
  const adultsMatch = input.match(/(\d+)\s*(adult|adult)/i);
  const childrenMatch = input.match(/(\d+)\s*(child|kid)/i);

  return {
    travelers: {
      adults: adultsMatch ? parseInt(adultsMatch[1]) : 1,
      children: childrenMatch ? parseInt(childrenMatch[1]) : 0,
    },
  };
}

function extractDates(input: string): Partial<ConversationState> {
  // Simple date extraction - in production, use a proper date parser
  const datePatterns = input.match(/\d{1,2}[-\/]\d{1,2}[-\/]\d{4}/g);
  if (datePatterns && datePatterns.length >= 2) {
    return {
      startDate: datePatterns[0],
      endDate: datePatterns[1],
    };
  }

  // Try to extract month-year patterns
  if (input.includes("december")) {
    return { startDate: "2026-12-15", endDate: "2026-12-22" };
  }

  return {};
}

function extractActivities(input: string): string[] {
  const keywords = [
    "adventure",
    "culture",
    "relaxation",
    "food",
    "nature",
    "beach",
    "hiking",
    "museum",
    "shopping",
  ];
  return keywords.filter((kw) => input.includes(kw));
}

export function buildConversationPrompt(state: ConversationState): string {
  const parts: string[] = [];

  if (state.destination) parts.push(`Destination: ${state.destination}`);
  if (state.travelers) {
    parts.push(
      `Travelers: ${state.travelers.adults} adults${state.travelers.children ? `, ${state.travelers.children} children` : ""}`
    );
  }
  if (state.startDate && state.endDate) {
    parts.push(`Dates: ${state.startDate} to ${state.endDate}`);
  }
  if (state.tripType) parts.push(`Trip Type: ${state.tripType}`);
  if (state.activities && state.activities.length > 0) {
    parts.push(`Interests: ${state.activities.join(", ")}`);
  }

  return parts.join("\n");
}
