import type { DocType, JobStatus, PaymentMethod, VersionStatus } from "./types";

export const DOC_LABELS: Record<DocType, string> = {
  AUTHORIZATION: "PDR Work Authorization",
  COMPLETION: "PDR Completion & Acceptance",
  INVOICE: "Invoice",
};

export const DOC_SHORT: Record<DocType, string> = {
  AUTHORIZATION: "Work Authorization",
  COMPLETION: "Completion & Acceptance",
  INVOICE: "Invoice",
};

export const DOC_STEP: Record<DocType, number> = { AUTHORIZATION: 1, COMPLETION: 2, INVOICE: 3 };

export const DOC_PREFIX: Record<DocType, string> = { AUTHORIZATION: "WA", COMPLETION: "CA", INVOICE: "INV" };

const SLUGS: Record<DocType, string> = {
  AUTHORIZATION: "authorization",
  COMPLETION: "completion",
  INVOICE: "invoice",
};

export function docSlug(type: DocType): string {
  return SLUGS[type];
}

export function docTypeFromSlug(slug: string): DocType | null {
  const hit = (Object.keys(SLUGS) as DocType[]).find((t) => SLUGS[t] === slug);
  return hit ?? null;
}

export const JOB_STATUS_LABELS: Record<JobStatus, string> = {
  AWAITING_AUTHORIZATION: "Awaiting authorization",
  IN_PROGRESS: "In progress",
  AWAITING_ACCEPTANCE: "Awaiting acceptance",
  READY_TO_INVOICE: "Ready to invoice",
  INVOICED: "Invoiced",
  PAID: "Paid",
  CANCELLED: "Cancelled",
};

export const VERSION_STATUS_LABELS: Record<VersionStatus, string> = {
  DRAFT: "Draft",
  SENT: "Sent",
  SIGNED: "Signed",
  SUPERSEDED: "Superseded",
  VOID: "Voided",
};

export const PAYMENT_METHOD_LABELS: Record<PaymentMethod, string> = {
  ACH: "ACH",
  CHECK: "Check",
  CARD: "Card",
  CASH: "Cash",
  OTHER: "Other",
};

export type Tone = "neutral" | "amber" | "violet" | "blue" | "green" | "red";

export const JOB_STATUS_TONE: Record<JobStatus, Tone> = {
  AWAITING_AUTHORIZATION: "amber",
  IN_PROGRESS: "blue",
  AWAITING_ACCEPTANCE: "violet",
  READY_TO_INVOICE: "blue",
  INVOICED: "violet",
  PAID: "green",
  CANCELLED: "neutral",
};

export const VERSION_STATUS_TONE: Record<VersionStatus, Tone> = {
  DRAFT: "neutral",
  SENT: "violet",
  SIGNED: "green",
  SUPERSEDED: "neutral",
  VOID: "red",
};
