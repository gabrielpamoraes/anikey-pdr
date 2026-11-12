import type { DocType, JobStatus, VersionStatus } from "./types";

export interface VersionLite {
  type: DocType;
  version: number;
  status: VersionStatus;
}

export interface JobStatusInput {
  cancelled: boolean;
  versions: VersionLite[];
  /** Amount of the invoice currently in effect, in cents (null when there is none). */
  invoiceAmountCents: number | null;
  paidCents: number;
}

/** The current version of a document: the highest-numbered one that has not been voided. */
export function currentVersion(versions: VersionLite[], type: DocType): VersionLite | null {
  const candidates = versions.filter((v) => v.type === type && v.status !== "VOID");
  if (candidates.length === 0) return null;
  return candidates.reduce((a, b) => (b.version > a.version ? b : a));
}

/** True when this document has ever been signed (the newest signed version may since have been superseded). */
export function hasBeenSigned(versions: VersionLite[], type: DocType): boolean {
  return versions.some((v) => v.type === type && (v.status === "SIGNED" || v.status === "SUPERSEDED"));
}

/**
 * Pure derivation of a job's stage from its documents and payments.
 *
 *  Authorization not signed ............ AWAITING_AUTHORIZATION
 *  Authorization signed ................ IN_PROGRESS
 *  Completion sent ..................... AWAITING_ACCEPTANCE
 *  Completion signed ................... READY_TO_INVOICE
 *  Invoice sent (or signed) ............ INVOICED
 *  Invoice fully paid .................. PAID
 *
 * "Overdue" is not a stored stage: it is INVOICED with a due date in the past (see queries).
 */
export function deriveJobStatus(input: JobStatusInput): JobStatus {
  if (input.cancelled) return "CANCELLED";

  const auth = currentVersion(input.versions, "AUTHORIZATION");
  const completion = currentVersion(input.versions, "COMPLETION");
  const invoice = currentVersion(input.versions, "INVOICE");

  const invoiceIssued = invoice !== null && (invoice.status === "SENT" || invoice.status === "SIGNED");
  if (invoiceIssued) {
    const amount = input.invoiceAmountCents;
    if (amount !== null && amount > 0 && input.paidCents >= amount) return "PAID";
    return "INVOICED";
  }

  if (completion?.status === "SIGNED") return "READY_TO_INVOICE";
  if (completion?.status === "SENT") return "AWAITING_ACCEPTANCE";
  if (auth?.status === "SIGNED") return "IN_PROGRESS";
  return "AWAITING_AUTHORIZATION";
}

/** Whether a document of this type may be started, given the job's documents. */
export function canStartDocument(
  type: DocType,
  versions: VersionLite[],
  enforceOrder: boolean,
): { ok: true } | { ok: false; reason: string } {
  if (!enforceOrder || type === "AUTHORIZATION") return { ok: true };
  if (type === "COMPLETION" && !hasBeenSigned(versions, "AUTHORIZATION")) {
    return { ok: false, reason: "The work authorization must be signed before the completion & acceptance." };
  }
  if (type === "INVOICE" && !hasBeenSigned(versions, "COMPLETION")) {
    return { ok: false, reason: "The completion & acceptance must be signed before the invoice." };
  }
  return { ok: true };
}
