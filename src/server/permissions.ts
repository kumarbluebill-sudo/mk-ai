export const TENANT_ROLES = [
  "OWNER",
  "ADMIN",
  "MANAGER",
  "CONSULTANT",
  "SALES",
  "ACCOUNTS",
  "READONLY",
] as const;

export type TenantRoleName = (typeof TENANT_ROLES)[number];

export type Action =
  | "chat:use"
  | "itinerary:read"
  | "itinerary:write"
  | "quotation:read"
  | "quotation:write"
  | "booking:read"
  | "booking:create"
  /** Confirm or cancel a supplier booking. Confirming spends the agency balance with the supplier. */
  | "booking:manage"
  | "payment:read"
  | "payment:manage"
  | "supplier:manage"
  | "markup:manage"
  | "staff:manage"
  | "tenant:settings"
  | "cost:view"; // internal supplier cost / margin

const ALL: Action[] = [
  "chat:use",
  "itinerary:read",
  "itinerary:write",
  "quotation:read",
  "quotation:write",
  "booking:read",
  "booking:create",
  "booking:manage",
  "payment:read",
  "payment:manage",
  "supplier:manage",
  "markup:manage",
  "staff:manage",
  "tenant:settings",
  "cost:view",
];

/** Default permission matrix. A later phase can make this tenant-configurable. */
const MATRIX: Record<TenantRoleName, readonly Action[]> = {
  OWNER: ALL,
  ADMIN: ALL.filter((a) => a !== "tenant:settings"),
  MANAGER: [
    "chat:use",
    "itinerary:read",
    "itinerary:write",
    "quotation:read",
    "quotation:write",
    "booking:read",
    "booking:create",
    "booking:manage",
    "payment:read",
    "markup:manage",
    "cost:view",
  ],
  CONSULTANT: [
    "chat:use",
    "itinerary:read",
    "itinerary:write",
    "quotation:read",
    "quotation:write",
    "booking:read",
    "booking:create",
  ],
  SALES: ["chat:use", "itinerary:read", "itinerary:write", "quotation:read", "quotation:write", "booking:read"],
  ACCOUNTS: ["itinerary:read", "quotation:read", "booking:read", "payment:read", "payment:manage", "cost:view"],
  READONLY: ["itinerary:read", "quotation:read", "booking:read"],
};

export function can(role: TenantRoleName | undefined | null, action: Action): boolean {
  if (!role) return false;
  return MATRIX[role]?.includes(action) ?? false;
}

export class ForbiddenError extends Error {
  constructor(action: Action) {
    super(`Forbidden: missing permission ${action}`);
    this.name = "ForbiddenError";
  }
}

export function assertCan(role: TenantRoleName | undefined | null, action: Action): void {
  if (!can(role, action)) throw new ForbiddenError(action);
}
