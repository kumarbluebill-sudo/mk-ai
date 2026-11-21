import type { PrismaClient } from "@/generated/prisma/client";

/**
 * Models that carry a `tenantId` column. Child models without one (Message,
 * ItineraryDay, ItineraryItem, QuotationItem, BookingItem, Refund) are reached
 * through a tenant-scoped parent and MUST be accessed only after verifying the
 * parent via the scoped client.
 */
export const TENANT_MODELS = new Set([
  "Customer",
  "Conversation",
  "Itinerary",
  "Quotation",
  "Booking",
  "Payment",
  "Voucher",
  "MarkupSetting",
  "CompanySettings",
  "SupplierCredential",
  "AiUsage",
  "Membership",
  "Subscription",
]);

type Args = Record<string, unknown> | undefined;

const WHERE_OPERATIONS = new Set([
  "findMany",
  "findFirst",
  "findFirstOrThrow",
  "findUnique",
  "findUniqueOrThrow",
  "count",
  "aggregate",
  "groupBy",
  "update",
  "updateMany",
  "delete",
  "deleteMany",
]);

function withTenantData<T>(data: T, tenantId: string): T {
  if (Array.isArray(data)) {
    return data.map((d) => ({ ...d, tenantId })) as unknown as T;
  }
  return { ...(data as object), tenantId } as T;
}

/**
 * Pure function that rewrites Prisma operation args so they can only touch
 * rows of `tenantId`. Exposed separately so it can be unit tested without a DB.
 */
export function applyTenantScope(operation: string, args: Args, tenantId: string): Record<string, unknown> {
  const a: Record<string, unknown> = { ...(args ?? {}) };

  if (WHERE_OPERATIONS.has(operation)) {
    a.where = { ...((a.where as object) ?? {}), tenantId };
  }

  if (operation === "create" || operation === "createMany" || operation === "createManyAndReturn") {
    a.data = withTenantData(a.data, tenantId);
  }

  if (operation === "upsert") {
    a.where = { ...((a.where as object) ?? {}), tenantId };
    a.create = withTenantData(a.create, tenantId);
    // Never allow an update to move a row to another tenant.
    if (a.update && typeof a.update === "object") {
      a.update = { ...(a.update as object), tenantId };
    }
  }

  if (operation === "update" || operation === "updateMany") {
    if (a.data && typeof a.data === "object") {
      a.data = { ...(a.data as object), tenantId };
    }
  }

  return a;
}

/** Returns a Prisma client whose tenant-owned models are restricted to one tenant. */
export function scopedPrisma(prisma: PrismaClient, tenantId: string) {
  if (!tenantId) throw new Error("tenantId is required for a scoped client");
  return prisma.$extends({
    query: {
      $allModels: {
        async $allOperations({ model, operation, args, query }) {
          if (!TENANT_MODELS.has(model)) return query(args);
          return query(applyTenantScope(operation, args as Args, tenantId) as typeof args);
        },
      },
    },
  });
}

export type ScopedPrisma = ReturnType<typeof scopedPrisma>;
