import { z } from "zod";
import { hashToken } from "@/lib/crypto";
import { db } from "@/lib/db";
import { appUrl } from "@/lib/env";
import { AppError } from "@/lib/errors";
import { documentPayloadSchema, parseInput, type DocumentPayload } from "@/domain/payloads";
import type { DocType, VersionStatus } from "@/domain/types";
import { getSignatureProvider } from "@/providers/signature";
import { getStorage, storageKeys } from "@/providers/storage";
import { recordAudit } from "./audit";
import { computeContentHash } from "./documents";
import { refreshJobSummary } from "./jobs";
import { sendSignedConfirmationEmail, sendStaffSignedEmail } from "./notifications";
import { generateSignedPdf } from "./pdf";

export interface RequestMeta {
  ip?: string | null;
  userAgent?: string | null;
}

export type PublicState = "invalid" | "expired" | "revoked" | "cancelled" | "replaced" | "ready" | "view" | "signed";

export interface PublicView {
  state: PublicState;
  versionId?: string;
  type?: DocType;
  number?: string;
  version?: number;
  versionStatus?: VersionStatus;
  payload?: DocumentPayload;
  requiresSignature?: boolean;
  org?: { name: string; timezone: string; phone: string | null; email: string };
  signature?: { signerName: string; signerTitle: string | null; signedAt: Date; exceptions: string | null };
  photos?: { id: string; kind: string; caption: string | null }[];
  signerHint?: { name: string | null; email: string };
  newerVersionExists?: boolean;
}

const requestInclude = {
  version: {
    include: {
      signature: true,
      document: { include: { job: { include: { org: true, photos: { orderBy: { createdAt: "asc" } } } } } },
    },
  },
} as const;

async function findRequest(token: string) {
  if (!token || token.length > 200) return null;
  return db.signingRequest.findUnique({ where: { tokenHash: hashToken(token) }, include: requestInclude });
}

/**
 * Resolve a signing link into what the customer should see. Never reveals anything for an unknown token.
 * `recordView` counts the visit and writes the first-view audit entry.
 */
export async function loadByToken(token: string, opts: { recordView?: boolean; meta?: RequestMeta } = {}): Promise<PublicView> {
  const request = await findRequest(token);
  if (!request) return { state: "invalid" };
  if (request.revokedAt) return { state: "revoked" };
  if (request.expiresAt <= new Date()) return { state: "expired" };

  const version = request.version;
  const job = version.document.job;
  if (job.status === "CANCELLED") return { state: "cancelled" };
  if (version.status === "VOID") return { state: "replaced" };

  const payload = documentPayloadSchema.parse(version.payload);
  const signed = version.status === "SIGNED" || version.status === "SUPERSEDED";
  const base: PublicView = {
    state: signed ? "signed" : request.requiresSignature ? "ready" : "view",
    versionId: version.id,
    type: version.document.type as DocType,
    number: version.document.number,
    version: version.version,
    versionStatus: version.status,
    payload,
    requiresSignature: request.requiresSignature,
    org: { name: job.org.name, timezone: job.org.timezone, phone: job.org.phone, email: job.org.email },
    signature: version.signature
      ? {
          signerName: version.signature.signerName,
          signerTitle: version.signature.signerTitle,
          signedAt: version.signature.signedAt,
          exceptions: version.signature.exceptions,
        }
      : undefined,
    photos:
      version.document.type === "COMPLETION"
        ? job.photos.filter((p) => p.kind !== "OTHER").map((p) => ({ id: p.id, kind: p.kind, caption: p.caption }))
        : [],
    signerHint: { name: request.sentToName, email: request.sentToEmail },
    newerVersionExists: version.status === "SUPERSEDED",
  };

  if (opts.recordView) {
    await db.$transaction(async (tx) => {
      const now = new Date();
      const first = request.firstViewedAt === null;
      await tx.signingRequest.update({
        where: { id: request.id },
        data: { viewCount: { increment: 1 }, lastViewedAt: now, ...(first ? { firstViewedAt: now } : {}) },
      });
      if (first) {
        await recordAudit(tx, {
          orgId: job.orgId,
          actorType: "CUSTOMER",
          actorLabel: request.sentToName ?? request.sentToEmail,
          action: "document.viewed",
          entityType: "DocumentVersion",
          entityId: version.id,
          jobId: job.id,
          metadata: { type: version.document.type, number: version.document.number, version: version.version },
          ip: opts.meta?.ip ?? null,
          userAgent: opts.meta?.userAgent ?? null,
        });
      }
    });
  }
  return base;
}

export const signInputSchema = z.object({
  signerName: z.string().trim().min(2, "enter your full name").max(120, "must be at most 120 characters"),
  signerTitle: z
    .string()
    .trim()
    .max(120, "must be at most 120 characters")
    .optional()
    .transform((v) => (v ? v : null)),
  authorityConfirmed: z.union([z.literal("on"), z.literal("true")], {
    errorMap: () => ({ message: "please confirm you are authorized to sign" }),
  }),
  signatureDataUrl: z.string().min(1, "please sign in the box"),
  exceptions: z
    .string()
    .trim()
    .max(2000, "must be at most 2000 characters")
    .optional()
    .transform((v) => (v ? v : null)),
});

export interface SignResult {
  versionId: string;
  number: string;
  type: DocType;
}

export async function signByToken(token: string, raw: unknown, meta: RequestMeta): Promise<SignResult> {
  const input = parseInput(signInputSchema, raw);
  const captured = getSignatureProvider().capture(input.signatureDataUrl);

  const request = await findRequest(token);
  if (!request || request.revokedAt) throw new AppError("This link is no longer active.", "forbidden");
  if (request.expiresAt <= new Date()) throw new AppError("This link has expired. Please ask for a new one.", "expired");
  if (!request.requiresSignature) throw new AppError("This document does not need a signature.", "conflict");

  const versionId = request.versionId;
  const type = request.version.document.type as DocType;
  const job = request.version.document.job;
  if (job.status === "CANCELLED") throw new AppError("This job was cancelled.", "conflict");

  const outcome = await db.$transaction(
    async (tx) => {
      // Atomic claim: only one request can move this version from SENT to SIGNED.
      const signedAt = new Date();
      const claimed = await tx.documentVersion.updateMany({ where: { id: versionId, status: "SENT" }, data: { status: "SIGNED", signedAt } });
      if (claimed.count !== 1) throw new AppError("This document was already signed or has been replaced.", "conflict");

      const version = await tx.documentVersion.findUniqueOrThrow({ where: { id: versionId }, include: { document: true } });
      const payload = documentPayloadSchema.parse(version.payload);
      const expected = computeContentHash(type, version.document.number, version.version, payload);
      if (!version.contentHash || version.contentHash !== expected) {
        throw new AppError("This document changed after it was sent. Please ask for a new link.", "conflict");
      }

      const signaturePath = storageKeys.signature(job.orgId, job.id, versionId);
      await getStorage().put(signaturePath, captured.png, "image/png");
      await tx.signature.create({
        data: {
          versionId,
          signerName: input.signerName,
          signerTitle: input.signerTitle,
          authorityConfirmed: true,
          exceptions: type === "COMPLETION" ? input.exceptions : null,
          signaturePath,
          signatureSha256: captured.sha256,
          contentHash: version.contentHash,
          ip: meta.ip ?? null,
          userAgent: meta.userAgent ?? null,
          provider: getSignatureProvider().name,
          signedAt,
        },
      });
      await tx.documentVersion.updateMany({
        where: { documentId: version.documentId, id: { not: versionId }, status: "SIGNED" },
        data: { status: "SUPERSEDED" },
      });
      await refreshJobSummary(tx, job.id);
      await recordAudit(tx, {
        orgId: job.orgId,
        actorType: "CUSTOMER",
        actorLabel: input.signerName,
        action: "document.signed",
        entityType: "DocumentVersion",
        entityId: versionId,
        jobId: job.id,
        metadata: {
          type,
          number: version.document.number,
          version: version.version,
          signerName: input.signerName,
          signerTitle: input.signerTitle,
          contentHash: version.contentHash,
          signatureSha256: captured.sha256,
          provider: getSignatureProvider().name,
        },
        ip: meta.ip ?? null,
        userAgent: meta.userAgent ?? null,
      });
      return { number: version.document.number, payload };
    },
    { timeout: 30_000 },
  );

  // The signature is already final in the database. The PDF and e-mails are derived from it and can be redone.
  let pdf: Uint8Array | null = null;
  try {
    pdf = await generateSignedPdf(versionId);
  } catch (e) {
    await db.$transaction((tx) =>
      recordAudit(tx, {
        orgId: job.orgId,
        actorType: "SYSTEM",
        actorLabel: "system",
        action: "pdf.failed",
        entityType: "DocumentVersion",
        entityId: versionId,
        jobId: job.id,
        metadata: { error: e instanceof Error ? e.message.slice(0, 200) : "unknown" },
      }),
    );
  }
  await notifySigned({ request, job, number: outcome.number, payload: outcome.payload, signerName: input.signerName, pdf });
  return { versionId, number: outcome.number, type };
}

async function notifySigned(args: {
  request: NonNullable<Awaited<ReturnType<typeof findRequest>>>;
  job: { id: string; orgId: string; number: string; org: { email: string }; technicianId: string | null };
  number: string;
  payload: DocumentPayload;
  signerName: string;
  pdf: Uint8Array | null;
}) {
  const { request, job } = args;
  const failures: string[] = [];
  try {
    await sendSignedConfirmationEmail({ to: request.sentToEmail, payload: args.payload, number: args.number, signerName: args.signerName, pdf: args.pdf });
  } catch (e) {
    failures.push(`customer: ${e instanceof Error ? e.message : "error"}`);
  }
  try {
    const tech = job.technicianId ? await db.user.findUnique({ where: { id: job.technicianId }, select: { email: true } }) : null;
    const recipients = Array.from(new Set([job.org.email, tech?.email].filter((e): e is string => !!e)));
    for (const to of recipients) {
      await sendStaffSignedEmail({ to, payload: args.payload, number: args.number, signerName: args.signerName, jobNumber: job.number, jobLink: `${appUrl()}/jobs/${job.id}` });
    }
  } catch (e) {
    failures.push(`staff: ${e instanceof Error ? e.message : "error"}`);
  }
  if (failures.length > 0) {
    await db.$transaction((tx) =>
      recordAudit(tx, {
        orgId: job.orgId,
        actorType: "SYSTEM",
        actorLabel: "system",
        action: "email.failed",
        entityType: "DocumentVersion",
        entityId: request.versionId,
        jobId: job.id,
        metadata: { failures },
      }),
    );
  }
}

/* ------------------------------------------------------------------ */
/* Files reachable through a valid link                                */
/* ------------------------------------------------------------------ */

const OPEN_STATES: PublicState[] = ["ready", "view", "signed"];

export async function getPublicPdf(token: string): Promise<{ bytes: Uint8Array; filename: string } | null> {
  const view = await loadByToken(token);
  if (!OPEN_STATES.includes(view.state) || !view.versionId) return null;
  const { getVersionPdf } = await import("./pdf");
  return getVersionPdf(view.versionId);
}

export async function getPublicPhoto(token: string, photoId: string): Promise<{ data: Uint8Array; contentType: string } | null> {
  const view = await loadByToken(token);
  if (!OPEN_STATES.includes(view.state) || !view.photos?.some((p) => p.id === photoId)) return null;
  const photo = await db.photo.findUnique({ where: { id: photoId }, select: { storagePath: true } });
  if (!photo) return null;
  return getStorage().get(photo.storagePath);
}
