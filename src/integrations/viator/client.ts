/**
 * VIATOR API Client
 * Handles activities, tours, and experiences from Viator supplier
 */

export interface ViatorSearchParams {
  destinationId?: string;
  keyword?: string;
  startDate?: string;
  endDate?: string;
  currency?: string;
  language?: string;
}

export interface ViatorActivity {
  id: string;
  title: string;
  description: string;
  price: number;
  currency: string;
  duration: string;
  rating?: number;
  reviews?: number;
  imageUrl?: string;
  availability?: boolean;
  cancellationPolicy?: string;
}

export interface ViatorSearchResponse {
  activities: ViatorActivity[];
  totalCount: number;
  hasMore: boolean;
}

export class ViatorClient {
  private apiBaseUrl: string;
  private apiKey: string;
  private environment: "sandbox" | "production";

  constructor() {
    this.environment =
      (process.env.VIATOR_API_ENV as "sandbox" | "production") || "sandbox";

    if (this.environment === "sandbox") {
      this.apiKey = process.env.VIATOR_SANDBOX_KEY || "";
      this.apiBaseUrl = "https://sandbox-viatorapi.viator.com/v2";
    } else {
      this.apiKey = process.env.VIATOR_PRODUCTION_KEY || "";
      this.apiBaseUrl = "https://viatorapi.viator.com/v2";
    }

    if (!this.apiKey) {
      throw new Error(
        `VIATOR_${this.environment.toUpperCase()}_KEY not configured`
      );
    }
  }

  async searchActivities(
    params: ViatorSearchParams
  ): Promise<ViatorSearchResponse> {
    try {
      const queryParams = new URLSearchParams();

      if (params.keyword) {
        queryParams.append("keyword", params.keyword);
      }
      if (params.destinationId) {
        queryParams.append("destinationId", params.destinationId);
      }
      if (params.startDate) {
        queryParams.append("startDate", params.startDate);
      }
      if (params.currency) {
        queryParams.append("currency", params.currency);
      }

      const response = await fetch(
        `${this.apiBaseUrl}/tours/search?${queryParams.toString()}`,
        {
          method: "GET",
          headers: {
            "Accept-Encoding": "gzip",
            "User-Agent": "mk-ai-travel/1.0",
            "X-Viator-API-Key": this.apiKey,
          },
        }
      );

      if (!response.ok) {
        const error = await response.text();
        console.error("VIATOR API Error:", error);
        throw new Error(`VIATOR API error: ${response.status} ${error}`);
      }

      const data = await response.json();
      return this.parseResponse(data);
    } catch (error) {
      console.error("VIATOR search error:", error);
      throw error;
    }
  }

  async getActivityDetails(activityId: string): Promise<ViatorActivity> {
    try {
      const response = await fetch(
        `${this.apiBaseUrl}/tours/${activityId}`,
        {
          method: "GET",
          headers: {
            "Accept-Encoding": "gzip",
            "User-Agent": "mk-ai-travel/1.0",
            "X-Viator-API-Key": this.apiKey,
          },
        }
      );

      if (!response.ok) {
        throw new Error(`Failed to fetch activity: ${response.status}`);
      }

      const data = await response.json();
      return this.parseActivity(data);
    } catch (error) {
      console.error("VIATOR activity fetch error:", error);
      throw error;
    }
  }

  async checkAvailability(
    activityId: string,
    date: string,
    participantCount: number
  ): Promise<boolean> {
    try {
      const response = await fetch(
        `${this.apiBaseUrl}/tours/${activityId}/availability`,
        {
          method: "POST",
          headers: {
            "Accept-Encoding": "gzip",
            "User-Agent": "mk-ai-travel/1.0",
            "X-Viator-API-Key": this.apiKey,
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            date,
            participantCount,
          }),
        }
      );

      if (!response.ok) {
        return false;
      }

      const data = await response.json();
      return data.available === true;
    } catch (error) {
      console.error("VIATOR availability check error:", error);
      return false;
    }
  }

  private parseResponse(data: any): ViatorSearchResponse {
    const activities = Array.isArray(data.data)
      ? data.data.map((item: any) => this.parseActivity(item))
      : [];

    return {
      activities,
      totalCount: data.pagination?.totalCount || activities.length,
      hasMore: data.pagination?.hasMore || false,
    };
  }

  private parseActivity(item: any): ViatorActivity {
    return {
      id: item.tourId?.toString() || item.id,
      title: item.title || "Unknown Activity",
      description: item.description || "",
      price: item.price?.fromPrice || 0,
      currency: item.price?.currency || "USD",
      duration: item.duration?.fixedDurationInMinutes
        ? `${Math.round(item.duration.fixedDurationInMinutes / 60)} hours`
        : "Variable",
      rating: item.reviews?.rating,
      reviews: item.reviews?.totalReviews,
      imageUrl: item.images?.[0]?.imageUrl,
      availability: item.availability?.isAvailable !== false,
      cancellationPolicy: item.cancellationPolicy?.description,
    };
  }

  getEnvironment(): string {
    return this.environment;
  }
}

export function getViatorClient(): ViatorClient {
  return new ViatorClient();
}
