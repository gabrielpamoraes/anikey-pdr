import { deflateSync } from "node:zlib";
import { randomUUID } from "node:crypto";
import { db } from "@/lib/db";
import { hashToken } from "@/lib/crypto";
import { DEFAULT_REMITTANCE, DEFAULT_SERVICE_TYPES, DEFAULT_TERMS_ACCEPTANCE, DEFAULT_TERMS_AUTHORIZATION, DEFAULT_TERMS_INVOICE } from "@/domain/defaults";
import type { Actor } from "@/domain/types";
import { setEmail } from "@/providers/email";
import { MemoryEmailProvider } from "@/providers/email/memory";
import { setStorage } from "@/providers/storage";
import { MemoryStorageProvider } from "@/providers/storage/memory";
import { createUser } from "@/services/auth";
import { createCustomer } from "@/services/customers";
import { createJob } from "@/services/jobs";

export function installMemoryProviders() {
  const storage = new MemoryStorageProvider();
  const email = new MemoryEmailProvider();
  setStorage(storage);
  setEmail(email);
  return { storage, email };
}

export async function createOrgFixture() {
  const suffix = randomUUID().slice(0, 8);
  const org = await db.organization.create({
    data: {
      name: "ANIKEY LLC",
      email: `office-${suffix}@anikey.test`,
      phone: "916-221-8883",
      addressLine: "Sacramento, CA",
      termsAuthorization: DEFAULT_TERMS_AUTHORIZATION,
      termsAcceptance: DEFAULT_TERMS_ACCEPTANCE,
      termsInvoice: DEFAULT_TERMS_INVOICE,
      remittanceInfo: DEFAULT_REMITTANCE,
      serviceTypes: { create: DEFAULT_SERVICE_TYPES.map((s, i) => ({ ...s, sortOrder: i })) },
    },
  });
  const admin = await createUser({ orgId: org.id, email: `admin-${suffix}@anikey.test`, name: "Admin Anna", password: "password-123", role: "ADMIN" });
  const tech = await createUser({ orgId: org.id, email: `tech-${suffix}@anikey.test`, name: "Tech Tom", password: "password-123", role: "TECHNICIAN" });
  const actor = (u: { id: string; name: string; role: "ADMIN" | "TECHNICIAN" }): Actor => ({
    orgId: org.id,
    userId: u.id,
    userName: u.name,
    role: u.role,
    ip: "203.0.113.5",
    userAgent: "vitest",
  });
  return { org, adminActor: actor(admin), techActor: actor(tech), admin, tech };
}

export async function createJobFixture(actor: Actor, overrides: { email?: string } = {}) {
  const customer = await createCustomer(actor, { name: "Dealership A", email: overrides.email ?? "buyer@dealer.test", phone: "555-0100", city: "Sacramento", state: "CA", zip: "95814" });
  const job = await createJob(actor, {
    customerId: customer.id,
    newContact: { name: "Casey Buyer", title: "Fleet Manager", email: overrides.email ?? "buyer@dealer.test", phone: "555-0101" },
    vehicle: { year: "2022", make: "Toyota", model: "Camry", vin: "4T1G11AK0NU123456", color: "White", licensePlate: "" },
    referenceNumber: "1042",
  });
  return { customer, job };
}

/** Pulls the signing token out of the most recent e-mail that contains a /s/<token> link. */
export function tokenFromEmail(email: MemoryEmailProvider): string {
  for (let i = email.sent.length - 1; i >= 0; i--) {
    const m = /\/s\/([A-Za-z0-9_-]{20,})/.exec(email.sent[i].text);
    if (m) return m[1];
  }
  throw new Error("No signing link found in sent e-mails");
}

export function tokenHashOf(token: string): string {
  return hashToken(token);
}

/* ---- A valid PNG data URL for the signature (a few drawn strokes on a transparent canvas) ---- */

function crc32(buf: Uint8Array): number {
  let c = ~0;
  for (const b of buf) {
    c ^= b;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  }
  return ~c >>> 0;
}

function chunk(type: string, data: Uint8Array): Buffer {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length);
  const typeBuf = Buffer.from(type, "ascii");
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(Buffer.concat([typeBuf, data])));
  return Buffer.concat([len, typeBuf, Buffer.from(data), crc]);
}

export function makePng(width = 120, height = 40): Buffer {
  const raw = Buffer.alloc((width * 4 + 1) * height);
  for (let y = 0; y < height; y++) {
    const row = y * (width * 4 + 1);
    raw[row] = 0;
    for (let x = 0; x < width; x++) {
      const onStroke = Math.abs(y - (20 + Math.round(10 * Math.sin(x / 8)))) < 2;
      const i = row + 1 + x * 4;
      raw[i] = 17;
      raw[i + 1] = 24;
      raw[i + 2] = 39;
      raw[i + 3] = onStroke ? 255 : 0;
    }
  }
  const header = Buffer.alloc(13);
  header.writeUInt32BE(width, 0);
  header.writeUInt32BE(height, 4);
  header[8] = 8; // bit depth
  header[9] = 6; // RGBA
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk("IHDR", header),
    chunk("IDAT", deflateSync(raw)),
    chunk("IEND", Buffer.alloc(0)),
  ]);
}

export function signatureDataUrl(): string {
  return `data:image/png;base64,${makePng().toString("base64")}`;
}
