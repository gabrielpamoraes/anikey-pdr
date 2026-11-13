import { z } from "zod";
import { db } from "@/lib/db";
import { AppError, assert } from "@/lib/errors";
import { parseInput } from "@/domain/payloads";
import type { Actor } from "@/domain/types";
import { auditForUser, recordAudit } from "./audit";

const optText = (max: number) =>
  z
    .string()
    .trim()
    .max(max, `must be at most ${max} characters`)
    .optional()
    .transform((v) => (v ? v : null));

function validTimeZone(tz: string): boolean {
  try {
    new Intl.DateTimeFormat("en-US", { timeZone: tz });
    return true;
  } catch {
    return false;
  }
}

export const orgSettingsSchema = z.object({
  name: z.string().trim().min(1, "required").max(120),
  email: z.string().trim().toLowerCase().email("enter a valid email address"),
  phone: optText(40),
  addressLine: optText(200),
  timezone: z.string().trim().refine(validTimeZone, "enter a valid time zone, e.g. America/Los_Angeles"),
  paymentTermsDays: z.coerce.number().int("enter a whole number").min(0).max(365),
  signingLinkDays: z.coerce.number().int("enter a whole number").min(1).max(90),
  enforceDocumentOrder: z
    .union([z.literal("on"), z.literal("true"), z.literal("")])
    .optional()
    .transform((v) => v === "on" || v === "true"),
  termsAuthorization: z.string().trim().min(1, "required").max(5000),
  termsAcceptance: z.string().trim().min(1, "required").max(5000),
  termsInvoice: z.string().trim().min(1, "required").max(5000),
  remittanceInfo: z.string().trim().min(1, "required").max(2000),
});

export async function updateOrgSettings(actor: Actor, raw: unknown) {
  assert(actor.role === "ADMIN", "Only an administrator can change settings.", "forbidden");
  const input = parseInput(orgSettingsSchema, raw);
  await db.$transaction(async (tx) => {
    await tx.organization.update({ where: { id: actor.orgId }, data: input });
    await recordAudit(tx, auditForUser(actor, { action: "settings.updated", entityType: "Organization", entityId: actor.orgId }));
  });
}

const serviceSchema = z.object({
  label: z.string().trim().min(1, "required").max(60, "must be at most 60 characters"),
});

function codeFromLabel(label: string): string {
  return label
    .toUpperCase()
    .replace(/[^A-Z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "")
    .slice(0, 40);
}

export async function addServiceType(actor: Actor, raw: unknown) {
  assert(actor.role === "ADMIN", "Only an administrator can change settings.", "forbidden");
  const { label } = parseInput(serviceSchema, raw);
  const code = codeFromLabel(label);
  if (!code) throw new AppError("Label: use letters or numbers.");
  const exists = await db.serviceType.findUnique({ where: { orgId_code: { orgId: actor.orgId, code } } });
  if (exists) throw new AppError("A service with that name already exists.", "conflict");
  const max = await db.serviceType.aggregate({ where: { orgId: actor.orgId }, _max: { sortOrder: true } });
  await db.$transaction(async (tx) => {
    const created = await tx.serviceType.create({ data: { orgId: actor.orgId, code, label, sortOrder: (max._max.sortOrder ?? 0) + 1 } });
    await recordAudit(tx, auditForUser(actor, { action: "service_type.added", entityType: "ServiceType", entityId: created.id, metadata: { label } }));
  });
}

export async function setServiceTypeActive(actor: Actor, id: string, active: boolean) {
  assert(actor.role === "ADMIN", "Only an administrator can change settings.", "forbidden");
  const existing = await db.serviceType.findFirst({ where: { id, orgId: actor.orgId } });
  if (!existing) throw new AppError("Service not found.", "not_found");
  if (!active) {
    const remaining = await db.serviceType.count({ where: { orgId: actor.orgId, active: true, id: { not: id } } });
    if (remaining === 0) throw new AppError("Keep at least one active service.", "conflict");
  }
  await db.$transaction(async (tx) => {
    await tx.serviceType.update({ where: { id }, data: { active } });
    await recordAudit(tx, auditForUser(actor, { action: active ? "service_type.enabled" : "service_type.disabled", entityType: "ServiceType", entityId: id, metadata: { label: existing.label } }));
  });
}
