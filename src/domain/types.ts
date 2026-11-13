/** Plain string-union mirrors of the Prisma enums, so domain code and tests need no database client. */

export const DOCUMENT_TYPES = ["AUTHORIZATION", "COMPLETION", "INVOICE"] as const;
export type DocType = (typeof DOCUMENT_TYPES)[number];

export const VERSION_STATUSES = ["DRAFT", "SENT", "SIGNED", "SUPERSEDED", "VOID"] as const;
export type VersionStatus = (typeof VERSION_STATUSES)[number];

export const JOB_STATUSES = [
  "AWAITING_AUTHORIZATION",
  "IN_PROGRESS",
  "AWAITING_ACCEPTANCE",
  "READY_TO_INVOICE",
  "INVOICED",
  "PAID",
  "CANCELLED",
] as const;
export type JobStatus = (typeof JOB_STATUSES)[number];

export const PAYMENT_METHODS = ["ACH", "CHECK", "CARD", "CASH", "OTHER"] as const;
export type PaymentMethod = (typeof PAYMENT_METHODS)[number];

export type Role = "ADMIN" | "TECHNICIAN";

/** Who is performing an action. Services take this instead of reading request state. */
export interface Actor {
  orgId: string;
  userId: string;
  userName: string;
  role: Role;
  ip?: string | null;
  userAgent?: string | null;
}
