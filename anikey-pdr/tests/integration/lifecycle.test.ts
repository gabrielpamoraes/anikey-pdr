import { beforeAll, describe, expect, it } from "vitest";
import { db } from "@/lib/db";
import { resetRateLimits } from "@/lib/rate-limit";
import { AppError } from "@/lib/errors";
import type { Actor } from "@/domain/types";
import type { MemoryEmailProvider } from "@/providers/email/memory";
import type { MemoryStorageProvider } from "@/providers/storage/memory";
import { verifyAuditChain } from "@/services/audit";
import { createDocumentDraft, discardDraft, getActiveLink, resendLink, reviseVersion, saveDraft, sendForSignature } from "@/services/documents";
import { cancelJob, recordPayment } from "@/services/jobs";
import { getVersionPdf } from "@/services/pdf";
import { getPublicPdf, loadByToken, signByToken } from "@/services/signing";
import { createJobFixture, createOrgFixture, installMemoryProviders, signatureDataUrl, tokenFromEmail } from "../helpers";

let email: MemoryEmailProvider;
let storage: MemoryStorageProvider;

beforeAll(() => {
  const p = installMemoryProviders();
  email = p.email;
  storage = p.storage;
  resetRateLimits();
});

const META = { ip: "198.51.100.7", userAgent: "Mozilla/5.0 (iPhone)" };

const authForm = {
  serviceCode: "FULL_CAR",
  observation: "Pull paint rail right",
  estimatedAmount: "1,200.00",
  startDate: "2026-10-20",
  targetDate: "2026-10-24",
  poNumber: "PO-77",
  paymentMethod: "ACH",
};

const signForm = (name = "Casey Buyer") => ({
  signerName: name,
  signerTitle: "Fleet Manager",
  authorityConfirmed: "on",
  signatureDataUrl: signatureDataUrl(),
  exceptions: "",
});

async function draftId(actor: Actor, jobId: string, type: "AUTHORIZATION" | "COMPLETION" | "INVOICE") {
  const doc = await createDocumentDraft(actor, jobId, type);
  return doc.versions[0].id;
}

/** Drive one document from draft to signed through the real services. */
async function signDocument(actor: Actor, jobId: string, type: "AUTHORIZATION" | "COMPLETION", form: Record<string, string>) {
  const versionId = await draftId(actor, jobId, type);
  await saveDraft(actor, versionId, form);
  await sendForSignature(actor, versionId, { toEmail: "buyer@dealer.test", toName: "Casey Buyer" });
  const token = tokenFromEmail(email);
  await signByToken(token, signForm(), META);
  return { versionId, token };
}

describe("full job lifecycle", () => {
  it("authorization -> completion -> invoice -> payment, with signatures, PDFs and an intact audit chain", async () => {
    const { org, techActor } = await createOrgFixture();
    const { job } = await createJobFixture(techActor);
    expect(job.number).toMatch(/^JOB-\d{4}-0001$/);

    // 1. Authorization
    const auth = await signDocument(techActor, job.id, "AUTHORIZATION", authForm);
    let row = await db.job.findUniqueOrThrow({ where: { id: job.id } });
    expect(row.status).toBe("IN_PROGRESS");
    expect(row.amountCents).toBe(120000);
    expect(row.serviceLabel).toBe("Full car");

    const signedAuth = await db.documentVersion.findUniqueOrThrow({ where: { id: auth.versionId }, include: { signature: true, document: true } });
    expect(signedAuth.status).toBe("SIGNED");
    expect(signedAuth.document.number).toMatch(/^WA-\d{4}-0001$/);
    expect(signedAuth.signature).toMatchObject({ signerName: "Casey Buyer", ip: "198.51.100.7", provider: "internal", authorityConfirmed: true });
    expect(signedAuth.signature?.contentHash).toBe(signedAuth.contentHash);
    expect(signedAuth.pdfPath).toBeTruthy();
    const pdf = storage.files.get(signedAuth.pdfPath!);
    expect(pdf?.contentType).toBe("application/pdf");
    expect(Buffer.from(pdf!.data.slice(0, 5)).toString()).toBe("%PDF-");

    // 2. Completion with customer exceptions
    const completion = await draftId(techActor, job.id, "COMPLETION");
    await saveDraft(techActor, completion, { serviceCode: "FULL_CAR", observation: "Pull paint rail right", completionDate: "2026-10-24", notes: "" });
    await sendForSignature(techActor, completion, { toEmail: "buyer@dealer.test", toName: "Casey Buyer" });
    expect((await db.job.findUniqueOrThrow({ where: { id: job.id } })).status).toBe("AWAITING_ACCEPTANCE");
    await signByToken(tokenFromEmail(email), { ...signForm(), exceptions: "Small ding left of the roof rail" }, META);
    row = await db.job.findUniqueOrThrow({ where: { id: job.id } });
    expect(row.status).toBe("READY_TO_INVOICE");
    const sigC = await db.signature.findUniqueOrThrow({ where: { versionId: completion } });
    expect(sigC.exceptions).toBe("Small ding left of the roof rail");

    // 3. Invoice (no signature required): due date = invoice date + terms
    const invoice = await draftId(techActor, job.id, "INVOICE");
    const draft = await db.documentVersion.findUniqueOrThrow({ where: { id: invoice } });
    expect(draft.payload).toMatchObject({ type: "INVOICE", amountCents: 120000, invoiceDate: "2026-10-24", dueDate: "2026-11-07", completionNumber: expect.stringMatching(/^CA-/) });
    await saveDraft(techActor, invoice, { serviceCode: "FULL_CAR", observation: "Pull paint rail right", amount: "1200.00", invoiceDate: "2026-10-24", dueDate: "2026-11-07", notes: "PO-77" });
    const sent = await sendForSignature(techActor, invoice, { toEmail: "buyer@dealer.test", toName: "Casey Buyer" });
    expect(sent.emailSent).toBe(true);
    row = await db.job.findUniqueOrThrow({ where: { id: job.id } });
    expect(row.status).toBe("INVOICED");
    expect(row.dueDate?.toISOString().slice(0, 10)).toBe("2026-11-07");

    const view = await loadByToken(tokenFromEmail(email), { recordView: true, meta: META });
    expect(view.state).toBe("view"); // acknowledgment not required
    await expect(signByToken(tokenFromEmail(email), signForm(), META)).rejects.toThrow(/does not need a signature/);
    expect(await getPublicPdf(tokenFromEmail(email))).not.toBeNull();

    // 4. Payments: partial, over-balance, final
    await recordPayment(techActor, job.id, { amountDollars: "200.00", method: "CHECK", paidAt: "2026-10-30", reference: "#1001" });
    expect((await db.job.findUniqueOrThrow({ where: { id: job.id } })).status).toBe("INVOICED");
    await expect(recordPayment(techActor, job.id, { amountDollars: "1000.01", method: "ACH", paidAt: "2026-10-30", reference: "" })).rejects.toThrow(/more than the balance/);
    await recordPayment(techActor, job.id, { amountDollars: "1000.00", method: "ACH", paidAt: "2026-10-31", reference: "" });
    row = await db.job.findUniqueOrThrow({ where: { id: job.id } });
    expect(row.status).toBe("PAID");
    expect(row.paidCents).toBe(120000);

    // 5. Audit trail is complete and tamper-evident
    const actions = (await db.auditLog.findMany({ where: { jobId: job.id }, orderBy: { seq: "asc" } })).map((a) => a.action);
    expect(actions).toEqual(expect.arrayContaining(["job.created", "document.created", "document.sent", "document.viewed", "document.signed", "pdf.generated", "payment.recorded"]));
    expect(await verifyAuditChain(org.id)).toMatchObject({ ok: true });
  });

  it("enforces the document order (and lets it be switched off)", async () => {
    const { org, adminActor, techActor } = await createOrgFixture();
    const { job } = await createJobFixture(techActor);
    await expect(createDocumentDraft(techActor, job.id, "COMPLETION")).rejects.toThrow(/work authorization must be signed/);
    await expect(createDocumentDraft(techActor, job.id, "INVOICE")).rejects.toThrow(/completion & acceptance must be signed/);

    await db.organization.update({ where: { id: org.id }, data: { enforceDocumentOrder: false } });
    await expect(createDocumentDraft(techActor, job.id, "COMPLETION")).resolves.toBeTruthy();
    void adminActor;
  });

  it("prevents a second document of the same type for a job", async () => {
    const { techActor } = await createOrgFixture();
    const { job } = await createJobFixture(techActor);
    await createDocumentDraft(techActor, job.id, "AUTHORIZATION");
    await expect(createDocumentDraft(techActor, job.id, "AUTHORIZATION")).rejects.toThrow(/already exists/);
  });
});

describe("signing rules", () => {
  it("accepts only one signature, even when submitted at the same time", async () => {
    const { techActor } = await createOrgFixture();
    const { job } = await createJobFixture(techActor);
    const versionId = await draftId(techActor, job.id, "AUTHORIZATION");
    await saveDraft(techActor, versionId, authForm);
    await sendForSignature(techActor, versionId, { toEmail: "buyer@dealer.test", toName: null });
    const token = tokenFromEmail(email);

    const results = await Promise.allSettled([signByToken(token, signForm("First Signer"), META), signByToken(token, signForm("Second Signer"), META)]);
    expect(results.filter((r) => r.status === "fulfilled")).toHaveLength(1);
    const rejected = results.find((r) => r.status === "rejected") as PromiseRejectedResult;
    expect((rejected.reason as AppError).message).toMatch(/already signed/);
    expect(await db.signature.count({ where: { versionId } })).toBe(1);
  });

  it("rejects bad input without changing anything", async () => {
    const { techActor } = await createOrgFixture();
    const { job } = await createJobFixture(techActor);
    const versionId = await draftId(techActor, job.id, "AUTHORIZATION");
    await saveDraft(techActor, versionId, authForm);
    await sendForSignature(techActor, versionId, { toEmail: "buyer@dealer.test", toName: null });
    const token = tokenFromEmail(email);

    await expect(signByToken(token, { ...signForm(), signerName: "X" }, META)).rejects.toThrow(/Printed name/);
    await expect(signByToken(token, { ...signForm(), authorityConfirmed: "" }, META)).rejects.toThrow(/authorized to sign/);
    await expect(signByToken(token, { ...signForm(), signatureDataUrl: "data:image/png;base64,AAAA" }, META)).rejects.toThrow(/Signature/);
    await expect(signByToken("not-a-real-token", signForm(), META)).rejects.toThrow(/no longer active/);
    expect((await db.documentVersion.findUniqueOrThrow({ where: { id: versionId } })).status).toBe("SENT");
  });

  it("refuses to sign when the stored content no longer matches the hash that was sent", async () => {
    const { techActor } = await createOrgFixture();
    const { job } = await createJobFixture(techActor);
    const versionId = await draftId(techActor, job.id, "AUTHORIZATION");
    await saveDraft(techActor, versionId, authForm);
    await sendForSignature(techActor, versionId, { toEmail: "buyer@dealer.test", toName: null });
    const token = tokenFromEmail(email);

    const v = await db.documentVersion.findUniqueOrThrow({ where: { id: versionId } });
    await db.documentVersion.update({ where: { id: versionId }, data: { payload: { ...(v.payload as object), estimatedAmountCents: 1 } } });
    await expect(signByToken(token, signForm(), META)).rejects.toThrow(/changed after it was sent/);
    expect((await db.documentVersion.findUniqueOrThrow({ where: { id: versionId } })).status).toBe("SENT");
    expect(await db.signature.count({ where: { versionId } })).toBe(0);
  });

  it("expired and revoked links stop working", async () => {
    const { techActor } = await createOrgFixture();
    const { job } = await createJobFixture(techActor);
    const versionId = await draftId(techActor, job.id, "AUTHORIZATION");
    await saveDraft(techActor, versionId, authForm);
    await sendForSignature(techActor, versionId, { toEmail: "buyer@dealer.test", toName: null });
    const oldToken = tokenFromEmail(email);

    // resend revokes the old link and issues a new one
    const again = await resendLink(techActor, versionId, { toEmail: "buyer@dealer.test", toName: null });
    expect((await loadByToken(oldToken)).state).toBe("revoked");
    const newToken = tokenFromEmail(email);
    expect(newToken).not.toBe(oldToken);
    expect(again.link).toContain(newToken);
    expect((await getActiveLink(techActor, versionId))?.link).toBe(again.link);

    await db.signingRequest.updateMany({ where: { versionId }, data: { expiresAt: new Date(Date.now() - 1000) } });
    expect((await loadByToken(newToken)).state).toBe("expired");
    await expect(signByToken(newToken, signForm(), META)).rejects.toThrow(/expired/);
    expect((await loadByToken("garbage")).state).toBe("invalid");
  });
});

describe("versions and revisions", () => {
  it("a signed version is never modified: revising creates a new version that supersedes it once signed", async () => {
    const { org, techActor } = await createOrgFixture();
    const { job } = await createJobFixture(techActor);
    const v1 = (await signDocument(techActor, job.id, "AUTHORIZATION", authForm)).versionId;
    const v1Before = await db.documentVersion.findUniqueOrThrow({ where: { id: v1 } });

    await expect(saveDraft(techActor, v1, authForm)).rejects.toThrow(/Only a draft can be edited/);
    const v2 = await reviseVersion(techActor, v1);
    expect(v2.version).toBe(2);
    expect(v2.status).toBe("DRAFT");
    expect((await db.job.findUniqueOrThrow({ where: { id: job.id } })).status).toBe("AWAITING_AUTHORIZATION");

    await saveDraft(techActor, v2.id, { ...authForm, estimatedAmount: "1500.00" });
    await sendForSignature(techActor, v2.id, { toEmail: "buyer@dealer.test", toName: null });
    await signByToken(tokenFromEmail(email), signForm(), META);

    const [a, b] = await Promise.all([db.documentVersion.findUniqueOrThrow({ where: { id: v1 } }), db.documentVersion.findUniqueOrThrow({ where: { id: v2.id } })]);
    expect(a.status).toBe("SUPERSEDED");
    expect(b.status).toBe("SIGNED");
    // v1 content, hash and PDF are untouched
    expect(a.payload).toEqual(v1Before.payload);
    expect(a.contentHash).toBe(v1Before.contentHash);
    expect(a.pdfSha256).toBe(v1Before.pdfSha256);
    const job2 = await db.job.findUniqueOrThrow({ where: { id: job.id } });
    expect(job2.status).toBe("IN_PROGRESS");
    expect(job2.amountCents).toBe(150000);
    expect(await verifyAuditChain(org.id)).toMatchObject({ ok: true });
  });

  it("revising a sent (unsigned) version voids it and revokes its link", async () => {
    const { techActor } = await createOrgFixture();
    const { job } = await createJobFixture(techActor);
    const v1 = await draftId(techActor, job.id, "AUTHORIZATION");
    await saveDraft(techActor, v1, authForm);
    await sendForSignature(techActor, v1, { toEmail: "buyer@dealer.test", toName: null });
    const oldToken = tokenFromEmail(email);

    const v2 = await reviseVersion(techActor, v1);
    expect((await db.documentVersion.findUniqueOrThrow({ where: { id: v1 } })).status).toBe("VOID");
    expect((await loadByToken(oldToken)).state).toBe("revoked");
    await expect(reviseVersion(techActor, v1)).rejects.toThrow(/Only a sent or signed version/);

    // discarding the new draft brings back no live version (v1 was voided), but v2 can also be discarded only if > 1
    await discardDraft(techActor, v2.id);
    expect((await db.documentVersion.findUniqueOrThrow({ where: { id: v2.id } })).status).toBe("VOID");
  });

  it("only the latest version can be revised", async () => {
    const { techActor } = await createOrgFixture();
    const { job } = await createJobFixture(techActor);
    const v1 = (await signDocument(techActor, job.id, "AUTHORIZATION", authForm)).versionId;
    await reviseVersion(techActor, v1);
    await expect(reviseVersion(techActor, v1)).rejects.toThrow(/latest version/);
  });
});

describe("validation, permissions and isolation", () => {
  it("validates draft fields with readable messages", async () => {
    const { techActor } = await createOrgFixture();
    const { job } = await createJobFixture(techActor);
    const v = await draftId(techActor, job.id, "AUTHORIZATION");
    await expect(saveDraft(techActor, v, { ...authForm, estimatedAmount: "abc" })).rejects.toThrow(/Estimated amount/);
    await expect(saveDraft(techActor, v, { ...authForm, startDate: "2026-13-40" })).rejects.toThrow(/Start date/);
    await expect(saveDraft(techActor, v, { ...authForm, targetDate: "2026-10-01" })).rejects.toThrow(/before the start date/);
    await expect(saveDraft(techActor, v, { ...authForm, serviceCode: "NOPE" })).rejects.toThrow(/Service/);
    await expect(saveDraft(techActor, v, { ...authForm, observation: "x".repeat(501) })).rejects.toThrow(/Observation/);
    // cannot send an unfilled draft
    await expect(sendForSignature(techActor, v, { toEmail: "buyer@dealer.test", toName: null })).rejects.toThrow(/Estimated amount/);
    await saveDraft(techActor, v, authForm);
    await expect(sendForSignature(techActor, v, { toEmail: "not-an-email", toName: null })).rejects.toThrow(/valid email/);
  });

  it("keeps organizations apart", async () => {
    const a = await createOrgFixture();
    const b = await createOrgFixture();
    const { job } = await createJobFixture(a.techActor);
    const v = await draftId(a.techActor, job.id, "AUTHORIZATION");
    await expect(createDocumentDraft(b.techActor, job.id, "COMPLETION")).rejects.toThrow(/not found/i);
    await expect(saveDraft(b.techActor, v, authForm)).rejects.toThrow(/not found/i);
    await expect(sendForSignature(b.techActor, v, { toEmail: "x@y.test", toName: null })).rejects.toThrow(/not found/i);
    await expect(recordPayment(b.techActor, job.id, { amountDollars: "1", method: "ACH", paidAt: "2026-01-01", reference: "" })).rejects.toThrow(/not found/i);
  });

  it("only an administrator can cancel a job, and cancelling kills open links", async () => {
    const { adminActor, techActor } = await createOrgFixture();
    const { job } = await createJobFixture(techActor);
    const v = await draftId(techActor, job.id, "AUTHORIZATION");
    await saveDraft(techActor, v, authForm);
    await sendForSignature(techActor, v, { toEmail: "buyer@dealer.test", toName: null });
    const token = tokenFromEmail(email);

    await expect(cancelJob(techActor, job.id, "x")).rejects.toThrow(/administrator/);
    await cancelJob(adminActor, job.id, "Customer withdrew");
    expect((await db.job.findUniqueOrThrow({ where: { id: job.id } })).status).toBe("CANCELLED");
    expect((await loadByToken(token)).state).toBe("revoked");
    await expect(saveDraft(techActor, v, authForm)).rejects.toThrow();
  });

  it("does not fail the send when e-mail delivery fails, and records it", async () => {
    const { techActor } = await createOrgFixture();
    const { job } = await createJobFixture(techActor);
    const v = await draftId(techActor, job.id, "AUTHORIZATION");
    await saveDraft(techActor, v, authForm);
    email.failNext = true;
    const result = await sendForSignature(techActor, v, { toEmail: "buyer@dealer.test", toName: null });
    expect(result.emailSent).toBe(false);
    expect(result.link).toMatch(/\/s\//);
    expect(await db.auditLog.count({ where: { jobId: job.id, action: "email.failed" } })).toBe(1);
  });

  it("regenerates a signed PDF on demand and serves an unsigned preview for drafts", async () => {
    const { techActor } = await createOrgFixture();
    const { job } = await createJobFixture(techActor);
    const draft = await draftId(techActor, job.id, "AUTHORIZATION");
    const preview = await getVersionPdf(draft);
    expect(preview.filename).toMatch(/-unsigned\.pdf$/);

    await saveDraft(techActor, draft, authForm);
    await sendForSignature(techActor, draft, { toEmail: "buyer@dealer.test", toName: null });
    await signByToken(tokenFromEmail(email), signForm(), META);
    const stored = (await db.documentVersion.findUniqueOrThrow({ where: { id: draft } })).pdfPath!;
    storage.files.delete(stored);
    const again = await getVersionPdf(draft);
    expect(Buffer.from(again.bytes.slice(0, 5)).toString()).toBe("%PDF-");
    expect(storage.files.has(stored)).toBe(true);
  });
});

describe("audit chain", () => {
  it("detects a tampered entry and a deleted entry", async () => {
    const { org, techActor } = await createOrgFixture();
    await createJobFixture(techActor);
    await createJobFixture(techActor);
    expect(await verifyAuditChain(org.id)).toMatchObject({ ok: true });

    const rows = await db.auditLog.findMany({ where: { orgId: org.id }, orderBy: { seq: "asc" } });
    expect(rows.length).toBeGreaterThanOrEqual(3);

    await db.auditLog.update({ where: { id: rows[1].id }, data: { actorLabel: "Someone Else" } });
    const tampered = await verifyAuditChain(org.id);
    expect(tampered.ok).toBe(false);
    expect(tampered.reason).toMatch(/does not match its hash/);
    await db.auditLog.update({ where: { id: rows[1].id }, data: { actorLabel: rows[1].actorLabel } });
    expect(await verifyAuditChain(org.id)).toMatchObject({ ok: true });

    await db.auditLog.delete({ where: { id: rows[1].id } });
    const deleted = await verifyAuditChain(org.id);
    expect(deleted.ok).toBe(false);
    expect(deleted.reason).toMatch(/Chain link/);
  });
});
