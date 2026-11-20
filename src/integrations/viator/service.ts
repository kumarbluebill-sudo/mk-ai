import type { PrismaClient } from "@/generated/prisma/client";
import { SupplierType } from "@/generated/prisma/client";
import { getViatorClient } from "./client";

export class ViatorService {
  private prisma: PrismaClient;
  private client: ReturnType<typeof getViatorClient>;

  constructor(prisma: PrismaClient) {
    this.prisma = prisma;
    this.client = getViatorClient();
  }

  async initializeSupplier() {
    try {
      const existing = await this.prisma.supplier.findUnique({
        where: {
          type_name: {
            type: SupplierType.VIATOR,
            name: "Viator",
          },
        },
      });

      if (existing) {
        return existing;
      }

      const supplier = await this.prisma.supplier.create({
        data: {
          type: SupplierType.VIATOR,
          name: "Viator",
          enabled: true,
          demoMode: false,
          config: {
            environment: this.client.getEnvironment(),
            supportedCurrencies: ["USD", "EUR", "GBP", "INR", "AUD"],
          },
        },
      });

      console.log("VIATOR supplier initialized:", supplier);
      return supplier;
    } catch (error) {
      console.error("Failed to initialize VIATOR supplier:", error);
      throw error;
    }
  }

  async searchAndStoreActivities(
    keyword: string,
    destinationId?: string
  ) {
    try {
      const supplier = await this.initializeSupplier();

      // Search on VIATOR
      const results = await this.client.searchActivities({
        keyword,
        destinationId,
        currency: "USD",
      });

      // Store results in database
      const storedActivities = [];
      for (const activity of results.activities) {
        const product = await this.prisma.supplierProduct.upsert({
          where: {
            supplierId_externalId: {
              supplierId: supplier.id,
              externalId: activity.id,
            },
          },
          update: {
            details: {
              title: activity.title,
              description: activity.description,
              rating: activity.rating,
              reviews: activity.reviews,
              imageUrl: activity.imageUrl,
              cancellationPolicy: activity.cancellationPolicy,
            },
          },
          create: {
            supplierId: supplier.id,
            externalId: activity.id,
            type: "ACTIVITY",
            name: activity.title,
            details: {
              title: activity.title,
              description: activity.description,
              price: activity.price,
              currency: activity.currency,
              duration: activity.duration,
              rating: activity.rating,
              reviews: activity.reviews,
              imageUrl: activity.imageUrl,
              availability: activity.availability,
              cancellationPolicy: activity.cancellationPolicy,
            },
          },
        });

        storedActivities.push(product);
      }

      return {
        supplierId: supplier.id,
        activitiesStored: storedActivities.length,
        activities: storedActivities,
      };
    } catch (error) {
      console.error("Failed to search and store activities:", error);
      throw error;
    }
  }

  async getStoredActivities(limit: number = 10) {
    try {
      const supplier = await this.prisma.supplier.findUnique({
        where: {
          type_name: {
            type: SupplierType.VIATOR,
            name: "Viator",
          },
        },
      });

      if (!supplier) {
        return { activities: [], supplierId: null };
      }

      const activities = await this.prisma.supplierProduct.findMany({
        where: {
          supplierId: supplier.id,
          type: "ACTIVITY",
        },
        take: limit,
      });

      return {
        supplierId: supplier.id,
        activities,
      };
    } catch (error) {
      console.error("Failed to get stored activities:", error);
      throw error;
    }
  }
}

export function getViatorService(prisma: PrismaClient): ViatorService {
  return new ViatorService(prisma);
}
