import type { Prisma } from "@prisma/client";
import { canonicalJson, decryptSecret, encryptSecret, hashToken, randomToken, sha256Hex } from "@/lib/crypto";
import { db, type DbOrTx, type Tx } from "@/lib/db";
import { appUrl } from "@/lib/env";
import { AppError, assert } from "@/lib/errors";
import { addDaysISO, todayISO, yearInTimeZone } from "@/lib/dates";
import { z } from "zod";
import { DOC_PREFIX } from "@/domain/labels";
import { canStartDocument, currentVersion, type VersionLite } from "@/domain/job-status";
import { formatNumber, renderTerms } from "@/domain/numbering";
import {
  authorizationInputSchema,
  completionInputSchema,
  documentPayloadSchema,
  invoiceInputSchema,
  parseInput,
  type AuthorizationPayload,
  type CompletionPayload,
  type DocumentPayload,
  type InvoicePayload,
} from "@/domain/payloads";
import type { Actor, DocType } from "@/domain/types";
import { auditForUser, recordAudit } from "./audit";
import { refreshJobSummary } from "./jobs";
import { sendSigningRequestEmail } from "./notifications";
import { nextSequence } from "./sequences";

/* ------------------------------------------------------------------ */
/* Loading                                                             */
/* ------------------------------------------------------------------ */

const jobInclude = {
  org: true,
  customer: true,
  contact: true,
  vehicle: true,
  documents: { include: { versions: { select: { id: true, version: true, status: true, payload: true } } } },
} satisfies Prisma.JobInclude;

type JobCtx = Prisma.JobGetPayload<{ include: typeof jobInclude }>;

async function loadJob(client: DbOrTx, orgId: string, jobId: string): Promise<JobCtx> {
  const job = await client.job.findFirst({ where: { id: jobId, orgId }, include: jobInclude });
  if (!job) throw new AppError("Job not found.", "not_found");
  return job;
}

function liteVersions(job: JobCtx): VersionLite[] {
  return job.documents.flatMap((d) => d.versions.map((v) => ({ type: d.type as DocType, version: v.version, status: v.status })));
}

function latestPayload(job: JobCtx, type: DocType): DocumentPayload | null {
  const doc = job.documents.find((d) => d.type === type);
  if (!doc) return null;
  const live = doc.versions.filter((v) => v.status !== "VOID").sort((a, b) => b.version - a.version)[0];
  return live ? documentPayloadSchema.parse(live.payload) : null;
}

export function computeContentHash(type: DocType, number: string, version: number, payload: DocumentPayload): string {
  return sha256Hex(canonicalJson({ type, number, version, payload }));
}

/* ------------------------------------------------------------------ */
/* Payload construction                                                */
/* ------------------------------------------------------------------ */

function formatAddress(c: { addressLine1: string | null; city: string | null; state: string | null; zip: string | null }): string | null {
  const cityLine = [c.city, [c.state, c.zip].filter(Boolean).join(" ")].filter(Boolean).join(", ");
  const full = [c.addressLine1, cityLine].filter(Boolean).join(", ");
  return full || null;
}

function termsFor(job: JobCtx, type: DocType): string {
  const raw = type === "AUTHORIZATION" ? job.org.termsAuthorization : type === "COMPLETION" ? job.org.termsAcceptance : job.org.termsInvoice;
  return renderTerms(raw, { paymentTermsDays: job.org.paymentTermsDays });
}

/** Snapshot of everything that comes from the organization, customer and vehicle (not typed per document). */
function buildBase(job: JobCtx, type: DocType) {
  const { org, customer, contact, vehicle } = job;
  return {
    issuer: { name: org.name, email: org.email, phone: org.phone, addressLine: org.addressLine },
    customer: {
      name: customer.name,
      contactName: contact?.name ?? null,
      contactTitle: contact?.title ?? null,
      contactEmail: contact?.email ?? customer.email,
      phone: contact?.phone ?? customer.phone,
      address: formatAddress(customer),
    },
    vehicle: {
      year: vehicle.year,
      make: vehicle.make,
      model: vehicle.model,
      vin: vehicle.vin,
      color: vehicle.color,
      licensePlate: vehicle.licensePlate,
      referenceNumber: job.referenceNumber,
    },
    terms: termsFor(job, type),
  };
}

async function activeServices(client: DbOrTx, orgId: string) {
  return client.serviceType.findMany({ where: { orgId, active: true }, orderBy: [{ sortOrder: "asc" }, { label: "asc" }] });
}

function defaultPayload(
  job: JobCtx,
  type: DocType,
  firstService: { code: string; label: string },
  numbers: { authorization: string | null; completion: string | null },
): DocumentPayload {
  const base = buildBase(job, type);
  const today = todayISO(job.org.timezone);
  const terms = job.org.paymentTermsDays;
  const auth = latestPayload(job, "AUTHORIZATION") as AuthorizationPayload | null;
  const completion = latestPayload(job, "COMPLETION") as CompletionPayload | null;

  if (type === "AUTHORIZATION") {
    return {
      type,
      ...base,
      serviceCode: firstService.code,
      serviceLabel: firstService.label,
      observation: "",
      estimatedAmountCents: 0,
      startDate: today,
      targetDate: null,
      poNumber: null,
      paymentMethod: null,
      paymentTermsDays: terms,
    };
  }
  const svc = completion ?? auth;
  const service = svc ? { code: svc.serviceCode, label: svc.serviceLabel, observation: svc.observation } : { ...firstService, observation: "" };
  if (type === "COMPLETION") {
    return {
      type,
      ...base,
      serviceCode: service.code,
      serviceLabel: service.label,
      observation: service.observation,
      authorizationNumber: numbers.authorization,
      completionDate: today,
      notes: null,
    };
  }
  const invoiceDate = completion?.completionDate ?? today;
  return {
    type,
    ...base,
    serviceCode: service.code,
    serviceLabel: service.label,
    observation: service.observation,
    authorizationNumber: numbers.authorization,
    completionNumber: numbers.completion,
    completionDate: completion?.completionDate ?? null,
    amountCents: auth?.estimatedAmountCents ?? 0,
    invoiceDate,
    dueDate: addDaysISO(invoiceDate, terms),
    paymentTermsDays: terms,
    notes: auth?.poNumber ? `PO ${auth.poNumber}` : null,
    remittance: job.org.remittanceInfo,
    requiresAcknowledgment: false,
  };
}

/** Merge staff-typed input into a payload, resolving the service label from the organization's list. */
async function applyInput(
  client: DbOrTx,
  job: JobCtx,
  type: DocType,
  existing: DocumentPayload,
  raw: unknown,
): Promise<DocumentPayload> {
  const services = await activeServices(client, job.orgId);
  const resolve = (code: string) => {
    const hit = services.find((s) => s.code === code);
    if (hit) return hit.label;
    if (existing.serviceCode === code) return existing.serviceLabel; // keep a since-disabled service on an old draft
    throw new AppError("Service: choose one of the listed services.");
  };

  if (type === "AUTHORIZATION") {
    const i = parseInput(authorizationInputSchema, raw);
    const prev = existing as AuthorizationPayload;
    return {
      ...prev,
      serviceCode: i.serviceCode,
      serviceLabel: resolve(i.serviceCode),
      observation: i.observation,
      estimatedAmountCents: i.estimatedAmount,
      startDate: i.startDate,
      targetDate: i.targetDate,
      poNumber: i.poNumber,
      paymentMethod: i.paymentMethod as AuthorizationPayload["paymentMethod"],
    };
  }
  if (type === "COMPLETION") {
    const i = parseInput(completionInputSchema, raw);
    const prev = existing as CompletionPayload;
    return { ...prev, serviceCode: i.serviceCode, serviceLabel: resolve(i.serviceCode), observation: i.observation, completionDate: i.completionDate, notes: i.notes };
  }
  const i = parseInput(invoiceInputSchema, raw);
  const prev = existing as InvoicePayload;
  return {
    ...prev,
    serviceCode: i.serviceCode,
    serviceLabel: resolve(i.serviceCode),
    observation: i.observation,
    amountCents: i.amount,
    invoiceDate: i.invoiceDate,
    dueDate: i.dueDate,
    notes: i.notes,
    requiresAcknowledgment: i.requiresAcknowledgment,
  };
}

function assertSendable(payload: DocumentPayload) {
  if (payload.type === "AUTHORIZATION") assert(payload.estimatedAmountCents > 0, "Estimated amount: enter an amount before sending.");
  if (payload.type === "INVOICE") assert(payload.amountCents > 0, "Amount: enter an amount before sending.");
}

/* ------------------------------------------------------------------ */
/* Draft lifecycle                                                     */
/* ------------------------------------------------------------------ */

export async function createDocumentDraft(actor: Actor, jobId: string, type: DocType) {
  return db.$transaction(
    async (tx) => {
      const job = await loadJob(tx, actor.orgId, jobId);
      assert(job.status !== "CANCELLED", "This job is cancelled.", "conflict");
      assert(!job.documents.some((d) => d.type === type), "This document already exists for the job.", "conflict");
      const allowed = canStartDocument(type, liteVersions(job), job.org.enforceDocumentOrder);
      if (!allowed.ok) throw new AppError(allowed.reason, "conflict");

      const services = await activeServices(tx, actor.orgId);
      if (services.length === 0) throw new AppError("Add at least one service type in Settings first.", "conflict");

      const year = yearInTimeZone(job.org.timezone);
      const seq = await nextSequence(tx, actor.orgId, `${DOC_PREFIX[type]}:${year}`);
      const number = formatNumber(DOC_PREFIX[type], year, seq);
      const numbers = {
        authorization: job.documents.find((d) => d.type === "AUTHORIZATION") ? await docNumber(tx, jobId, "AUTHORIZATION") : null,
        completion: job.documents.find((d) => d.type === "COMPLETION") ? await docNumber(tx, jobId, "COMPLETION") : null,
      };
      const payload = defaultPayload(job, type, services[0], numbers);

      const document = await tx.document.create({
        data: {
          jobId,
          type,
          number,
          versions: { create: { version: 1, status: "DRAFT", payload: payload as unknown as Prisma.InputJsonValue, createdById: actor.userId } },
        },
        include: { versions: true },
      });
      await refreshJobSummary(tx, jobId);
      await recordAudit(
        tx,
        auditForUser(actor, { action: "document.created", entityType: "DocumentVersion", entityId: document.versions[0].id, jobId, metadata: { type, number, version: 1 } }),
      );
      return document;
    },
    { timeout: 20_000 },
  );
}

async function docNumber(tx: Tx, jobId: string, type: DocType): Promise<string | null> {
  const d = await tx.document.findUnique({ where: { jobId_type: { jobId, type } }, select: { number: true } });
  return d?.number ?? null;
}

async function loadVersionForActor(client: DbOrTx, actor: Actor, versionId: string) {
  const version = await client.documentVersion.findFirst({
    where: { id: versionId, document: { job: { orgId: actor.orgId } } },
    include: { document: true },
  });
  if (!version) throw new AppError("Document not found.", "not_found");
  return version;
}

export async function saveDraft(actor: Actor, versionId: string, raw: unknown) {
  await db.$transaction(
    async (tx) => {
      const version = await loadVersionForActor(tx, actor, versionId);
      assert(version.status === "DRAFT", "Only a draft can be edited. Use Revise to change a sent or signed document.", "conflict");
      const job = await loadJob(tx, actor.orgId, version.document.jobId);
      assert(job.status !== "CANCELLED", "This job is cancelled.", "conflict");
      const existing = documentPayloadSchema.parse(version.payload);
      const next = await applyInput(tx, job, version.document.type as DocType, existing, raw);
      documentPayloadSchema.parse(next);
      await tx.documentVersion.update({ where: { id: versionId }, data: { payload: next as unknown as Prisma.InputJsonValue } });
      await refreshJobSummary(tx, job.id);
      await recordAudit(
        tx,
        auditForUser(actor, {
          action: "document.draft_saved",
          entityType: "DocumentVersion",
          entityId: versionId,
          jobId: job.id,
          metadata: { type: version.document.type, number: version.document.number, version: version.version },
        }),
      );
    },
    { timeout: 20_000 },
  );
}

export async function discardDraft(actor: Actor, versionId: string) {
  await db.$transaction(async (tx) => {
    const version = await loadVersionForActor(tx, actor, versionId);
    assert(version.status === "DRAFT", "Only a draft can be discarded.", "conflict");
    assert(version.version > 1, "The first version cannot be discarded.", "conflict");
    await tx.documentVersion.update({ where: { id: versionId }, data: { status: "VOID", voidedAt: new Date(), voidReason: "discarded" } });
    await refreshJobSummary(tx, version.document.jobId);
    await recordAudit(
      tx,
      auditForUser(actor, {
        action: "document.draft_discarded",
        entityType: "DocumentVersion",
        entityId: versionId,
        jobId: version.document.jobId,
        metadata: { type: version.document.type, number: version.document.number, version: version.version },
      }),
    );
  });
}

/* ------------------------------------------------------------------ */
/* Sending                                                             */
/* ------------------------------------------------------------------ */

export const sendInputSchema = z.object({
  toEmail: z.string().trim().toLowerCase().email("enter a valid email address"),
  toName: z
    .string()
    .trim()
    .max(120)
    .nullish()
    .transform((v) => (v ? v : null)),
});

export interface SendResult {
  link: string;
  emailSent: boolean;
  expiresAt: Date;
}

function linkFor(token: string): string {
  return `${appUrl()}/s/${token}`;
}

async function createSigningRequest(
  tx: Tx,
  args: { versionId: string; toEmail: string; toName: string | null; requiresSignature: boolean; days: number; actorId: string },
) {
  const token = randomToken();
  const expiresAt = new Date(Date.now() + args.days * 24 * 60 * 60 * 1000);
  await tx.signingRequest.create({
    data: {
      versionId: args.versionId,
      tokenHash: hashToken(token),
      tokenCipher: encryptSecret(token),
      sentToEmail: args.toEmail,
      sentToName: args.toName,
      requiresSignature: args.requiresSignature,
      expiresAt,
      createdById: args.actorId,
    },
  });
  return { token, expiresAt };
}

export async function sendForSignature(actor: Actor, versionId: string, raw: unknown): Promise<SendResult> {
  const input = parseInput(sendInputSchema, raw);

  const sent = await db.$transaction(
    async (tx) => {
      const version = await loadVersionForActor(tx, actor, versionId);
      assert(version.status === "DRAFT", "This document was already sent.", "conflict");
      const type = version.document.type as DocType;
      const job = await loadJob(tx, actor.orgId, version.document.jobId);
      assert(job.status !== "CANCELLED", "This job is cancelled.", "conflict");
      const allowed = canStartDocument(type, liteVersions(job), job.org.enforceDocumentOrder);
      if (!allowed.ok) throw new AppError(allowed.reason, "conflict");

      // Final snapshot: refresh organization / customer / vehicle / terms text, then freeze with a hash.
      const stored = documentPayloadSchema.parse(version.payload);
      const payload = documentPayloadSchema.parse({ ...stored, ...buildBase(job, type) }) as DocumentPayload;
      assertSendable(payload);
      const contentHash = computeContentHash(type, version.document.number, version.version, payload);
      const requiresSignature = payload.type !== "INVOICE" || payload.requiresAcknowledgment;

      await tx.documentVersion.update({
        where: { id: versionId },
        data: { status: "SENT", sentAt: new Date(), payload: payload as unknown as Prisma.InputJsonValue, contentHash },
      });
      const request = await createSigningRequest(tx, {
        versionId,
        toEmail: input.toEmail,
        toName: input.toName,
        requiresSignature,
        days: job.org.signingLinkDays,
        actorId: actor.userId,
      });
      await refreshJobSummary(tx, job.id);
      await recordAudit(
        tx,
        auditForUser(actor, {
          action: "document.sent",
          entityType: "DocumentVersion",
          entityId: versionId,
          jobId: job.id,
          metadata: { type, number: version.document.number, version: version.version, to: input.toEmail, contentHash, requiresSignature },
        }),
      );
      return { request, payload, number: version.document.number, jobId: job.id, requiresSignature };
    },
    { timeout: 20_000 },
  );

  const link = linkFor(sent.request.token);
  const emailSent = await deliverRequestEmail(actor, {
    jobId: sent.jobId,
    versionId,
    to: input.toEmail,
    toName: input.toName,
    payload: sent.payload,
    number: sent.number,
    link,
    expiresAt: sent.request.expiresAt,
    requiresSignature: sent.requiresSignature,
  });
  return { link, emailSent, expiresAt: sent.request.expiresAt };
}

async function deliverRequestEmail(
  actor: Actor,
  a: {
    jobId: string;
    versionId: string;
    to: string;
    toName: string | null;
    payload: DocumentPayload;
    number: string;
    link: string;
    expiresAt: Date;
    requiresSignature: boolean;
  },
): Promise<boolean> {
  try {
    await sendSigningRequestEmail({
      to: a.to,
      toName: a.toName,
      payload: a.payload,
      number: a.number,
      link: a.link,
      expiresAt: a.expiresAt,
      requiresSignature: a.requiresSignature,
    });
    return true;
  } catch (e) {
    // The link is still valid and can be copied by staff, so a mail failure must not fail the send.
    await db.$transaction((tx) =>
      recordAudit(
        tx,
        auditForUser(actor, {
          action: "email.failed",
          entityType: "DocumentVersion",
          entityId: a.versionId,
          jobId: a.jobId,
          metadata: { to: a.to, error: e instanceof Error ? e.message.slice(0, 200) : "unknown" },
        }),
      ),
    );
    return false;
  }
}

/** Issue a fresh link for a version that is out for signature. Older links stop working. */
export async function resendLink(actor: Actor, versionId: string, raw: unknown): Promise<SendResult> {
  const input = parseInput(sendInputSchema, raw);
  const out = await db.$transaction(
    async (tx) => {
      const version = await loadVersionForActor(tx, actor, versionId);
      assert(version.status === "SENT", "Only a document that is out for signature can be resent.", "conflict");
      const job = await loadJob(tx, actor.orgId, version.document.jobId);
      assert(job.status !== "CANCELLED", "This job is cancelled.", "conflict");
      const payload = documentPayloadSchema.parse(version.payload);
      const requiresSignature = payload.type !== "INVOICE" || payload.requiresAcknowledgment;
      await tx.signingRequest.updateMany({ where: { versionId, revokedAt: null }, data: { revokedAt: new Date() } });
      const request = await createSigningRequest(tx, {
        versionId,
        toEmail: input.toEmail,
        toName: input.toName,
        requiresSignature,
        days: job.org.signingLinkDays,
        actorId: actor.userId,
      });
      await recordAudit(
        tx,
        auditForUser(actor, {
          action: "document.link_resent",
          entityType: "DocumentVersion",
          entityId: versionId,
          jobId: job.id,
          metadata: { type: version.document.type, number: version.document.number, to: input.toEmail },
        }),
      );
      return { request, payload, number: version.document.number, jobId: job.id, requiresSignature };
    },
    { timeout: 20_000 },
  );
  const link = linkFor(out.request.token);
  const emailSent = await deliverRequestEmail(actor, {
    jobId: out.jobId,
    versionId,
    to: input.toEmail,
    toName: input.toName,
    payload: out.payload,
    number: out.number,
    link,
    expiresAt: out.request.expiresAt,
    requiresSignature: out.requiresSignature,
  });
  return { link, emailSent, expiresAt: out.request.expiresAt };
}

/** The current signing link of a sent version, for staff to copy (e.g. to text it to the customer). */
export async function getActiveLink(actor: Actor, versionId: string): Promise<{ link: string; expiresAt: Date; sentTo: string } | null> {
  const version = await loadVersionForActor(db, actor, versionId);
  if (version.status !== "SENT") return null;
  const request = await db.signingRequest.findFirst({
    where: { versionId, revokedAt: null, expiresAt: { gt: new Date() } },
    orderBy: { createdAt: "desc" },
  });
  if (!request) return null;
  return { link: linkFor(decryptSecret(request.tokenCipher)), expiresAt: request.expiresAt, sentTo: request.sentToEmail };
}

/* ------------------------------------------------------------------ */
/* Revising                                                            */
/* ------------------------------------------------------------------ */

/**
 * Changes after sending or signing create a NEW version that must be signed again.
 * A signed version is never modified; it becomes SUPERSEDED only when its replacement is signed.
 * A version that is out for signature but unsigned is voided and its link revoked.
 */
export async function reviseVersion(actor: Actor, versionId: string) {
  return db.$transaction(
    async (tx) => {
      const version = await loadVersionForActor(tx, actor, versionId);
      const doc = version.document;
      const job = await loadJob(tx, actor.orgId, doc.jobId);
      assert(job.status !== "CANCELLED", "This job is cancelled.", "conflict");
      assert(version.status === "SENT" || version.status === "SIGNED", "Only a sent or signed version can be revised.", "conflict");

      const all = await tx.documentVersion.findMany({ where: { documentId: doc.id }, select: { version: true, status: true } });
      const latest = currentVersion(all.map((v) => ({ type: doc.type as DocType, version: v.version, status: v.status })), doc.type as DocType);
      assert(latest?.version === version.version, "Only the latest version can be revised.", "conflict");

      if (version.status === "SENT") {
        await tx.documentVersion.update({ where: { id: version.id }, data: { status: "VOID", voidedAt: new Date(), voidReason: "revised" } });
        await tx.signingRequest.updateMany({ where: { versionId: version.id, revokedAt: null }, data: { revokedAt: new Date() } });
      }
      const maxVersion = Math.max(...all.map((v) => v.version));
      const next = await tx.documentVersion.create({
        data: {
          documentId: doc.id,
          version: maxVersion + 1,
          status: "DRAFT",
          payload: version.payload as Prisma.InputJsonValue,
          createdById: actor.userId,
        },
      });
      await refreshJobSummary(tx, job.id);
      await recordAudit(
        tx,
        auditForUser(actor, {
          action: "document.revised",
          entityType: "DocumentVersion",
          entityId: next.id,
          jobId: job.id,
          metadata: { type: doc.type, number: doc.number, from: version.version, to: next.version, previousStatus: version.status },
        }),
      );
      return next;
    },
    { timeout: 20_000 },
  );
}
