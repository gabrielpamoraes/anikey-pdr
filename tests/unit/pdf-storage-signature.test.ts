import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { PDFDocument } from "pdf-lib";
import { afterAll, describe, expect, it } from "vitest";
import { AppError } from "@/lib/errors";
import type { DocumentPayload } from "@/domain/payloads";
import { renderDocumentPdf, toWinAnsi } from "@/providers/pdf/render";
import { InternalSignatureProvider } from "@/providers/signature";
import { LocalStorageProvider } from "@/providers/storage/local";
import { makePng, signatureDataUrl } from "../helpers";

const base = {
  issuer: { name: "ANIKEY LLC", email: "office@anikey.test", phone: "916-221-8883", addressLine: "Sacramento, CA" },
  customer: { name: "Dealership A", contactName: "Casey Buyer", contactTitle: "Fleet Manager", contactEmail: "buyer@dealer.test", phone: "555-0101", address: "1 Main St, Sacramento, CA 95814" },
  vehicle: { year: 2022, make: "Toyota", model: "Camry", vin: "4T1G11AK0NU123456", color: "White", licensePlate: null, referenceNumber: "1042" },
  serviceCode: "FULL_CAR",
  serviceLabel: "Full car",
  observation: "Pull paint rail right",
  terms: "1. Authorization. Text.\n2. Payment due within 14 days.",
};

const payloads: Record<string, DocumentPayload> = {
  AUTHORIZATION: { type: "AUTHORIZATION", ...base, estimatedAmountCents: 120000, startDate: "2026-10-20", targetDate: "2026-10-24", poNumber: "PO-77", paymentMethod: "ACH", paymentTermsDays: 14 },
  COMPLETION: { type: "COMPLETION", ...base, authorizationNumber: "WA-2026-0001", completionDate: "2026-10-24", notes: null },
  INVOICE: { type: "INVOICE", ...base, authorizationNumber: "WA-2026-0001", completionNumber: "CA-2026-0001", completionDate: "2026-10-24", amountCents: 120000, invoiceDate: "2026-10-24", dueDate: "2026-11-07", paymentTermsDays: 14, notes: "PO-77", remittance: "Payable to ANIKEY LLC.", requiresAcknowledgment: false },
};

const signature = { signerName: "Casey Buyer", signerTitle: "Fleet Manager", signedAt: new Date("2026-10-24T16:42:00Z"), ip: "198.51.100.7", png: new Uint8Array(makePng()), exceptions: null, authorityConfirmed: true };

async function load(bytes: Uint8Array) {
  return PDFDocument.load(bytes);
}

describe("pdf rendering", () => {
  for (const type of ["AUTHORIZATION", "COMPLETION", "INVOICE"] as const) {
    it(`renders a ${type} draft, a sent copy and a signed copy`, async () => {
      for (const status of ["DRAFT", "SENT"] as const) {
        const bytes = await renderDocumentPdf({ number: "X-2026-0001", version: 1, status, payload: payloads[type], contentHash: "a".repeat(64), timeZone: "America/Los_Angeles" });
        expect(Buffer.from(bytes.slice(0, 5)).toString()).toBe("%PDF-");
        expect((await load(bytes)).getPageCount()).toBeGreaterThanOrEqual(1);
      }
      const signed = await renderDocumentPdf({ number: "X-2026-0001", version: 2, status: "SIGNED", payload: payloads[type], contentHash: "a".repeat(64), timeZone: "America/Los_Angeles", signature });
      const pdf = await load(signed);
      expect(pdf.getTitle()).toContain("X-2026-0001");
      expect(signed.length).toBeGreaterThan(2000);
    });
  }

  it("survives unusual text: unicode, very long words, long terms spanning pages, empty optional fields", async () => {
    const p = { ...payloads.COMPLETION, observation: "Roof → left éè 中文 " + "x".repeat(300), terms: Array.from({ length: 120 }, (_, i) => `Clause ${i}: ${"lorem ipsum ".repeat(12)}`).join("\n"), customer: { ...base.customer, contactName: null, address: null } } as DocumentPayload;
    const bytes = await renderDocumentPdf({ number: "CA-2026-0002", version: 1, status: "SIGNED", payload: p, contentHash: null, timeZone: "UTC", signature: { ...signature, exceptions: "Ding → roof" } });
    expect((await load(bytes)).getPageCount()).toBeGreaterThan(1);
  });

  it("keeps only characters the standard fonts can encode", () => {
    expect(toWinAnsi("café – “quoted” → 中")).toBe("café – “quoted” -> ?");
  });
});

describe("signature capture", () => {
  const provider = new InternalSignatureProvider();
  it("accepts a real PNG data URL and fingerprints it", () => {
    const got = provider.capture(signatureDataUrl());
    expect(got.sha256).toMatch(/^[0-9a-f]{64}$/);
    expect(got.png.length).toBeGreaterThan(100);
  });
  it("rejects wrong types, bad base64, non-PNG bytes, empty and oversized images", () => {
    const bad = [
      "",
      "hello",
      "data:image/jpeg;base64,/9j/4AAQ",
      "data:image/png;base64,@@@@",
      `data:image/png;base64,${Buffer.alloc(300, 1).toString("base64")}`,
      `data:image/png;base64,${Buffer.alloc(500_000, 1).toString("base64")}`,
    ];
    for (const b of bad) expect(() => provider.capture(b), b.slice(0, 30)).toThrow(AppError);
  });
});

describe("local storage", () => {
  const dir = mkdtempSync(path.join(tmpdir(), "anikey-storage-"));
  const storage = new LocalStorageProvider(dir);
  afterAll(() => rmSync(dir, { recursive: true, force: true }));

  it("stores, reads and deletes", async () => {
    await storage.put("org/jobs/j1/documents/a.pdf", new Uint8Array([1, 2, 3]));
    const got = await storage.get("org/jobs/j1/documents/a.pdf");
    expect([...got!.data]).toEqual([1, 2, 3]);
    expect(got!.contentType).toBe("application/pdf");
    await storage.delete("org/jobs/j1/documents/a.pdf");
    expect(await storage.get("org/jobs/j1/documents/a.pdf")).toBeNull();
  });
  it("refuses paths that escape its root", async () => {
    await expect(storage.put("../escape.txt", new Uint8Array([1]))).rejects.toThrow(/Invalid storage path/);
    await expect(storage.get("a/../../escape.txt")).rejects.toThrow(/Invalid storage path/);
  });
});
