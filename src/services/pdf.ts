import { sha256Hex } from "@/lib/crypto";
import { db } from "@/lib/db";
import { AppError } from "@/lib/errors";
import { documentPayloadSchema } from "@/domain/payloads";
import { renderDocumentPdf, type PdfSignature } from "@/providers/pdf/render";
import { getStorage, storageKeys } from "@/providers/storage";
import { recordAudit } from "./audit";

const versionInclude = {
  document: { include: { job: { include: { org: { select: { timezone: true } } } } } },
  signature: true,
} as const;

async function loadVersion(versionId: string) {
  const version = await db.documentVersion.findUnique({ where: { id: versionId }, include: versionInclude });
  if (!version) throw new AppError("Document not found.", "not_found");
  return version;
}

type LoadedVersion = Awaited<ReturnType<typeof loadVersion>>;

async function toPdfInput(version: LoadedVersion) {
  const payload = documentPayloadSchema.parse(version.payload);
  let signature: PdfSignature | null = null;
  if (version.signature) {
    const stored = await getStorage().get(version.signature.signaturePath);
    if (!stored) throw new Error("Signature image is missing from storage");
    signature = {
      signerName: version.signature.signerName,
      signerTitle: version.signature.signerTitle,
      signedAt: version.signature.signedAt,
      ip: version.signature.ip,
      png: stored.data,
      exceptions: version.signature.exceptions,
      authorityConfirmed: version.signature.authorityConfirmed,
    };
  }
  return {
    number: version.document.number,
    version: version.version,
    status: version.status,
    payload,
    contentHash: version.contentHash,
    timeZone: version.document.job.org.timezone,
    signature,
  };
}

/** Render the final PDF for a signed version, store it, and record its checksum. Safe to call again. */
export async function generateSignedPdf(versionId: string): Promise<Uint8Array> {
  const version = await loadVersion(versionId);
  if (!version.signature) throw new AppError("This version has not been signed.", "conflict");
  const bytes = await renderDocumentPdf(await toPdfInput(version));
  const job = version.document.job;
  const path = storageKeys.signedPdf(job.orgId, job.id, version.document.number, version.version);
  await getStorage().put(path, bytes, "application/pdf");
  const pdfSha256 = sha256Hex(bytes);
  await db.$transaction(async (tx) => {
    await tx.documentVersion.update({ where: { id: versionId }, data: { pdfPath: path, pdfSha256 } });
    await recordAudit(tx, {
      orgId: job.orgId,
      actorType: "SYSTEM",
      actorLabel: "system",
      action: "pdf.generated",
      entityType: "DocumentVersion",
      entityId: versionId,
      jobId: job.id,
      metadata: { path, pdfSha256 },
    });
  });
  return bytes;
}

export interface PdfFile {
  bytes: Uint8Array;
  filename: string;
}

/** The PDF for a version: the stored signed copy when it exists, otherwise a fresh render (marked draft/unsigned). */
export async function getVersionPdf(versionId: string): Promise<PdfFile> {
  const version = await loadVersion(versionId);
  const label = `${version.document.number}-v${version.version}`;
  if (version.pdfPath) {
    const stored = await getStorage().get(version.pdfPath);
    if (stored) return { bytes: stored.data, filename: `${label}.pdf` };
  }
  if (version.signature) return { bytes: await generateSignedPdf(versionId), filename: `${label}.pdf` };
  return { bytes: await renderDocumentPdf(await toPdfInput(version)), filename: `${label}-unsigned.pdf` };
}

export async function orgIdOfVersion(versionId: string): Promise<string | null> {
  const v = await db.documentVersion.findUnique({ where: { id: versionId }, select: { document: { select: { job: { select: { orgId: true } } } } } });
  return v?.document.job.orgId ?? null;
}

