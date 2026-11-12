import { z } from "zod";
import { db } from "@/lib/db";
import { AppError } from "@/lib/errors";
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

const optEmail = z
  .string()
  .trim()
  .max(200)
  .optional()
  .transform((v) => (v ? v.toLowerCase() : null))
  .refine((v) => v === null || z.string().email().safeParse(v).success, "enter a valid email address");

export const customerInputSchema = z.object({
  name: z.string().trim().min(1, "required").max(120, "must be at most 120 characters"),
  email: optEmail,
  phone: optText(40),
  addressLine1: optText(200),
  city: optText(100),
  state: optText(40),
  zip: optText(20),
  notes: optText(1000),
});

export const contactInputSchema = z.object({
  name: z.string().trim().min(1, "required").max(120, "must be at most 120 characters"),
  title: optText(120),
  email: optEmail,
  phone: optText(40),
});

export type CustomerInput = z.infer<typeof customerInputSchema>;
export type ContactInput = z.infer<typeof contactInputSchema>;

export async function createCustomer(actor: Actor, raw: unknown) {
  const input = parseInput(customerInputSchema, raw);
  return db.$transaction(async (tx) => {
    const customer = await tx.customer.create({ data: { orgId: actor.orgId, ...input } });
    await recordAudit(
      tx,
      auditForUser(actor, { action: "customer.created", entityType: "Customer", entityId: customer.id, metadata: { name: customer.name } }),
    );
    return customer;
  });
}

export async function addContact(actor: Actor, customerId: string, raw: unknown) {
  const input = parseInput(contactInputSchema, raw);
  const customer = await db.customer.findFirst({ where: { id: customerId, orgId: actor.orgId }, select: { id: true } });
  if (!customer) throw new AppError("Customer not found.", "not_found");
  return db.$transaction(async (tx) => {
    const contact = await tx.contact.create({ data: { customerId, ...input } });
    await recordAudit(
      tx,
      auditForUser(actor, { action: "contact.created", entityType: "Contact", entityId: contact.id, metadata: { customerId, name: contact.name } }),
    );
    return contact;
  });
}
