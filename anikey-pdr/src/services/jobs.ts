import { randomUUID } from "node:crypto";
import { z } from "zod";
import { db, type Tx } from "@/lib/db";
import { AppError, assert } from "@/lib/errors";
import { dateColumnToISO, isoToDateColumn, isValidISODate, todayISO, yearInTimeZone } from "@/lib/dates";
import { parseUsdToCents } from "@/lib/money";
import { currentVersion, deriveJobStatus, type VersionLite } from "@/domain/job-status";
import { formatNumber } from "@/domain/numbering";
import { documentPayloadSchema, parseInput, payloadAmountCents } from "@/domain/payloads";
import { PAYMENT_METHODS, type Actor, type DocType } from "@/domain/types";
import { getStorage, storageKeys } from "@/providers/storage";
import { auditForUser, recordAudit } from "./audit";
import { contactInputSchema } from "./customers";
import { nextSequence } from "./sequences";

/* ------------------------------------------------------------------ */
/* Read-model maintenance                                              */
/* ------------------------------------------------------------------ */

/**
 * Recomputes a job's stage and its denormalized summary columns from its documents and payments.
 * Call inside the same transaction as any change that affects them.
 */
export async function refreshJobSummary(tx: Tx, jobId: string): Promise<void> {
  const job = await tx.job.findUniqueOrThrow({
    where: { id: jobId },
    include: {
      documents: { include: { versions: { select: { version: true, status: true, payload: true } } } },
      payments: { select: { amountCents: true } },
    },
  });

  const lite: VersionLite[] = [];
  const payloadOf = new Map<string, ReturnType<typeof documentPayloadSchema.parse>>();
  for (const doc of job.documents) {
    for (const v of doc.versions) {
      lite.push({ type: doc.type as DocType, version: v.version, status: v.status });
      payloadOf.set(`${doc.type}:${v.version}`, documentPayloadSchema.parse(v.payload));
    }
  }

  const paidCents = job.payments.reduce((sum, p) => sum + p.amountCents, 0);
  const invoice = currentVersion(lite, "INVOICE");
  const invoicePayload = invoice ? payloadOf.get(`INVOICE:${invoice.version}`) : undefined;
  const invoiceIssued = invoice && (invoice.status === "SENT" || invoice.status === "SIGNED");

  const status = deriveJobStatus({
    cancelled: job.status === "CANCELLED",
    versions: lite,
    invoiceAmountCents: invoiceIssued && invoicePayload ? payloadAmountCents(invoicePayload) : null,
    paidCents,
  });

  const auth = currentVersion(lite, "AUTHORIZATION");
  const completion = currentVersion(lite, "COMPLETION");
  const authPayload = auth ? payloadOf.get(`AUTHORIZATION:${auth.version}`) : undefined;
  const completionPayload = completion ? payloadOf.get(`COMPLETION:${completion.version}`) : undefined;
  const best = invoicePayload ?? completionPayload ?? authPayload;

  await tx.job.update({
    where: { id: jobId },
    data: {
      status,
      paidCents,
      serviceLabel: best?.serviceLabel ?? null,
      amountCents: (invoicePayload && payloadAmountCents(invoicePayload)) ?? (authPayload && payloadAmountCents(authPayload)) ?? null,
      dueDate: invoiceIssued && invoicePayload?.type === "INVOICE" ? isoToDateColumn(invoicePayload.dueDate) : null,
    },
  });
}

/* ------------------------------------------------------------------ */
/* Jobs                                                                */
/* ------------------------------------------------------------------ */

const optText = (max: number) =>
  z
    .string()
    .trim()
    .max(max, `must be at most ${max} characters`)
    .optional()
    .transform((v) => (v ? v : null));

export const vehicleInputSchema = z.object({
  year: z
    .string()
    .trim()
    .optional()
    .transform((v) => (v ? Number(v) : null))
    .refine((v) => v === null || (Number.isInteger(v) && v >= 1900 && v <= 2100), "enter a valid year"),
  make: z.string().trim().min(1, "required").max(60),
  model: z.string().trim().min(1, "required").max(60),
  vin: z
    .string()
    .trim()
    .toUpperCase()
    .optional()
    .transform((v) => (v ? v : null))
    .refine((v) => v === null || /^[A-HJ-NPR-Z0-9]{11,17}$/.test(v), "enter 11 to 17 letters and digits (no I, O or Q)"),
  color: optText(40),
  licensePlate: optText(20),
});

export const createJobSchema = z.object({
  customerId: z.string().min(1),
  contactId: z.string().optional(),
  newContact: contactInputSchema.optional(),
  vehicle: vehicleInputSchema,
  referenceNumber: optText(60),
});

export async function createJob(actor: Actor, raw: unknown) {
  const input = parseInput(createJobSchema, raw);
  const customer = await db.customer.findFirst({
    where: { id: input.customerId, orgId: actor.orgId },
    include: { org: { select: { timezone: true } } },
  });
  if (!customer) throw new AppError("Customer not found.", "not_found");

  return db.$transaction(
    async (tx) => {
      let contactId: string | null = null;
      if (input.newContact) {
        const contact = await tx.contact.create({ data: { customerId: customer.id, ...input.newContact } });
        contactId = contact.id;
      } else if (input.contactId) {
        const existing = await tx.contact.findFirst({ where: { id: input.contactId, customerId: customer.id }, select: { id: true } });
        if (!existing) throw new AppError("Contact not found.", "not_found");
        contactId = existing.id;
      }

      const vehicle = await tx.vehicle.create({
        data: { orgId: actor.orgId, customerId: customer.id, ...input.vehicle },
      });

      const year = yearInTimeZone(customer.org.timezone);
      const seq = await nextSequence(tx, actor.orgId, `JOB:${year}`);
      const job = await tx.job.create({
        data: {
          orgId: actor.orgId,
          number: formatNumber("JOB", year, seq),
          customerId: customer.id,
          contactId,
          vehicleId: vehicle.id,
          technicianId: actor.userId,
          referenceNumber: input.referenceNumber,
        },
      });
      await recordAudit(
        tx,
        auditForUser(actor, {
          action: "job.created",
          entityType: "Job",
          entityId: job.id,
          jobId: job.id,
          metadata: { number: job.number, customer: customer.name },
        }),
      );
      return job;
    },
    { timeout: 20_000 },
  );
}

export async function getJobForActor(actor: Actor, jobId: string) {
  const job = await db.job.findFirst({ where: { id: jobId, orgId: actor.orgId } });
  if (!job) throw new AppError("Job not found.", "not_found");
  return job;
}

export async function cancelJob(actor: Actor, jobId: string, reason: string | null) {
  assert(actor.role === "ADMIN", "Only an administrator can cancel a job.", "forbidden");
  const job = await getJobForActor(actor, jobId);
  assert(job.status !== "CANCELLED", "This job is already cancelled.", "conflict");
  assert(job.status !== "PAID", "A paid job cannot be cancelled.", "conflict");
  await db.$transaction(async (tx) => {
    await tx.job.update({ where: { id: jobId }, data: { status: "CANCELLED" } });
    // Links that are still open must stop working.
    await tx.signingRequest.updateMany({
      where: { version: { document: { jobId } }, revokedAt: null },
      data: { revokedAt: new Date() },
    });
    await recordAudit(
      tx,
      auditForUser(actor, { action: "job.cancelled", entityType: "Job", entityId: jobId, jobId, metadata: { reason: reason?.slice(0, 500) ?? null } }),
    );
  });
}

/* ------------------------------------------------------------------ */
/* Payments                                                            */
/* ------------------------------------------------------------------ */

export const paymentInputSchema = z.object({
  amountDollars: z
    .string()
    .trim()
    .transform((v, ctx) => {
      const cents = parseUsdToCents(v);
      if (cents === null || cents <= 0) {
        ctx.addIssue({ code: z.ZodIssueCode.custom, message: "enter an amount greater than zero" });
        return z.NEVER;
      }
      return cents;
    }),
  method: z.enum(PAYMENT_METHODS, { errorMap: () => ({ message: "choose a payment method" }) }),
  paidAt: z.string().trim().refine(isValidISODate, "enter a valid date"),
  reference: optText(120),
});

export async function recordPayment(actor: Actor, jobId: string, raw: unknown) {
  const input = parseInput(paymentInputSchema, raw);
  const job = await db.job.findFirst({
    where: { id: jobId, orgId: actor.orgId },
    include: { org: { select: { timezone: true } } },
  });
  if (!job) throw new AppError("Job not found.", "not_found");
  assert(job.status !== "CANCELLED", "This job is cancelled.", "conflict");
  assert(input.paidAt <= todayISO(job.org.timezone), "Payment date cannot be in the future.");

  await db.$transaction(
    async (tx) => {
      // Lock the job row so two simultaneous payments cannot both pass the balance check.
      await tx.$executeRaw`SELECT id FROM "Job" WHERE id = ${jobId} FOR UPDATE`;
      const fresh = await tx.job.findUniqueOrThrow({
        where: { id: jobId },
        include: { documents: { include: { versions: { select: { version: true, status: true, payload: true } } } } },
      });
      const invoiceDoc = fresh.documents.find((d) => d.type === "INVOICE");
      const issued = invoiceDoc?.versions
        .filter((v) => v.status === "SENT" || v.status === "SIGNED")
        .sort((a, b) => b.version - a.version)[0];
      if (!issued) throw new AppError("Send the invoice before recording a payment.", "conflict");
      const payload = documentPayloadSchema.parse(issued.payload);
      const invoiceCents = payloadAmountCents(payload) ?? 0;
      const balance = invoiceCents - fresh.paidCents;
      if (input.amountDollars > balance) {
        throw new AppError(`Payment is more than the balance due (${(balance / 100).toFixed(2)}).`, "conflict");
      }
      const payment = await tx.payment.create({
        data: {
          jobId,
          amountCents: input.amountDollars,
          method: input.method,
          paidAt: isoToDateColumn(input.paidAt),
          reference: input.reference,
          recordedById: actor.userId,
        },
      });
      await refreshJobSummary(tx, jobId);
      await recordAudit(
        tx,
        auditForUser(actor, {
          action: "payment.recorded",
          entityType: "Payment",
          entityId: payment.id,
          jobId,
          metadata: { amountCents: payment.amountCents, method: payment.method, paidAt: input.paidAt, reference: input.reference },
        }),
      );
    },
    { timeout: 20_000 },
  );
}

/* ------------------------------------------------------------------ */
/* Photos                                                              */
/* ------------------------------------------------------------------ */

const PHOTO_TYPES: Record<string, string> = { "image/jpeg": "jpg", "image/png": "png", "image/webp": "webp" };
const MAX_PHOTO_BYTES = 10 * 1024 * 1024;

function sniffImage(data: Uint8Array): string | null {
  if (data[0] === 0xff && data[1] === 0xd8 && data[2] === 0xff) return "image/jpeg";
  if (data[0] === 0x89 && data[1] === 0x50 && data[2] === 0x4e && data[3] === 0x47) return "image/png";
  if (data[0] === 0x52 && data[1] === 0x49 && data[2] === 0x46 && data[3] === 0x46 && data[8] === 0x57 && data[9] === 0x45) return "image/webp";
  return null;
}

export async function addPhoto(
  actor: Actor,
  jobId: string,
  input: { kind: "BEFORE" | "AFTER" | "OTHER"; caption?: string | null; data: Uint8Array },
) {
  await getJobForActor(actor, jobId);
  assert(input.data.length > 0, "Choose a photo to upload.");
  assert(input.data.length <= MAX_PHOTO_BYTES, "Each photo must be 10 MB or smaller.");
  // Trust the file's real content, not the browser-reported type.
  const contentType = sniffImage(input.data);
  if (!contentType) throw new AppError("Please upload a JPEG, PNG or WebP photo.");

  const id = randomUUID();
  const storagePath = storageKeys.photo(actor.orgId, jobId, id, PHOTO_TYPES[contentType]);
  await getStorage().put(storagePath, input.data, contentType);
  await db.$transaction(async (tx) => {
    await tx.photo.create({
      data: {
        id,
        jobId,
        kind: input.kind,
        storagePath,
        contentType,
        caption: input.caption?.slice(0, 200) || null,
        uploadedById: actor.userId,
      },
    });
    await recordAudit(tx, auditForUser(actor, { action: "photo.added", entityType: "Photo", entityId: id, jobId, metadata: { kind: input.kind } }));
  });
  return id;
}

export async function deletePhoto(actor: Actor, photoId: string) {
  const photo = await db.photo.findFirst({ where: { id: photoId, job: { orgId: actor.orgId } } });
  if (!photo) throw new AppError("Photo not found.", "not_found");
  await db.$transaction(async (tx) => {
    await tx.photo.delete({ where: { id: photoId } });
    await recordAudit(tx, auditForUser(actor, { action: "photo.deleted", entityType: "Photo", entityId: photoId, jobId: photo.jobId }));
  });
  await getStorage().delete(photo.storagePath);
}

export { dateColumnToISO };
