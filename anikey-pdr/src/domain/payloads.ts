import { z } from "zod";
import { AppError } from "@/lib/errors";
import { isValidISODate } from "@/lib/dates";
import { parseUsdToCents } from "@/lib/money";
import { PAYMENT_METHODS } from "./types";

/* ------------------------------------------------------------------ */
/* Stored document payloads (what is hashed, signed and rendered)      */
/* ------------------------------------------------------------------ */

const isoDate = z.string().refine(isValidISODate, "invalid date");
const nullableText = z.string().nullable();

export const issuerSchema = z.object({
  name: z.string(),
  email: z.string(),
  phone: nullableText,
  addressLine: nullableText,
});

export const customerSnapshotSchema = z.object({
  name: z.string(),
  contactName: nullableText,
  contactTitle: nullableText,
  contactEmail: nullableText,
  phone: nullableText,
  address: nullableText,
});

export const vehicleSnapshotSchema = z.object({
  year: z.number().int().nullable(),
  make: z.string(),
  model: z.string(),
  vin: nullableText,
  color: nullableText,
  licensePlate: nullableText,
  referenceNumber: nullableText,
});

const basePayload = {
  issuer: issuerSchema,
  customer: customerSnapshotSchema,
  vehicle: vehicleSnapshotSchema,
  serviceCode: z.string().min(1),
  serviceLabel: z.string().min(1),
  observation: z.string().max(500),
  terms: z.string(),
};

export const authorizationPayloadSchema = z.object({
  type: z.literal("AUTHORIZATION"),
  ...basePayload,
  // 0 is allowed while the draft is being filled in; sending requires a positive amount (assertSendable).
  estimatedAmountCents: z.number().int().min(0),
  startDate: isoDate,
  targetDate: isoDate.nullable(),
  poNumber: nullableText,
  paymentMethod: z.enum(PAYMENT_METHODS).nullable(),
  paymentTermsDays: z.number().int().min(0).max(365),
});

export const completionPayloadSchema = z.object({
  type: z.literal("COMPLETION"),
  ...basePayload,
  authorizationNumber: nullableText,
  completionDate: isoDate,
  notes: nullableText,
});

export const invoicePayloadSchema = z.object({
  type: z.literal("INVOICE"),
  ...basePayload,
  authorizationNumber: nullableText,
  completionNumber: nullableText,
  completionDate: isoDate.nullable(),
  amountCents: z.number().int().min(0),
  invoiceDate: isoDate,
  dueDate: isoDate,
  paymentTermsDays: z.number().int().min(0).max(365),
  notes: nullableText,
  remittance: z.string(),
  requiresAcknowledgment: z.boolean(),
});

export const documentPayloadSchema = z.discriminatedUnion("type", [
  authorizationPayloadSchema,
  completionPayloadSchema,
  invoicePayloadSchema,
]);

export type AuthorizationPayload = z.infer<typeof authorizationPayloadSchema>;
export type CompletionPayload = z.infer<typeof completionPayloadSchema>;
export type InvoicePayload = z.infer<typeof invoicePayloadSchema>;
export type DocumentPayload = z.infer<typeof documentPayloadSchema>;

/** Dollar amount shown on a payload, whichever document it is. */
export function payloadAmountCents(p: DocumentPayload): number | null {
  if (p.type === "AUTHORIZATION") return p.estimatedAmountCents;
  if (p.type === "INVOICE") return p.amountCents;
  return null;
}

/* ------------------------------------------------------------------ */
/* Form input (what staff type); validated, then merged into a payload */
/* ------------------------------------------------------------------ */

const text = (max: number) =>
  z
    .string()
    .trim()
    .max(max, `must be at most ${max} characters`)
    .transform((v) => (v === "" ? null : v));

const requiredIsoDate = z.string().trim().refine(isValidISODate, "enter a valid date");
const optionalIsoDate = z
  .string()
  .trim()
  .transform((v) => (v === "" ? null : v))
  .refine((v) => v === null || isValidISODate(v), "enter a valid date");

const money = z
  .string()
  .trim()
  .transform((v, ctx) => {
    const cents = parseUsdToCents(v);
    if (cents === null || cents <= 0) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, message: "enter an amount greater than zero, e.g. 1200.00" });
      return z.NEVER;
    }
    return cents;
  });

const service = z.string().trim().min(1, "choose a service");
const observation = z
  .string()
  .trim()
  .max(500, "must be at most 500 characters")
  .default("");

export const authorizationInputSchema = z
  .object({
    serviceCode: service,
    observation,
    estimatedAmount: money,
    startDate: requiredIsoDate,
    targetDate: optionalIsoDate,
    poNumber: text(80),
    paymentMethod: z
      .string()
      .trim()
      .transform((v) => (v === "" ? null : v))
      .refine((v) => v === null || (PAYMENT_METHODS as readonly string[]).includes(v), "choose a payment method"),
  })
  .refine((v) => v.targetDate === null || v.targetDate >= v.startDate, {
    message: "target completion cannot be before the start date",
    path: ["targetDate"],
  });

export const completionInputSchema = z.object({
  serviceCode: service,
  observation,
  completionDate: requiredIsoDate,
  notes: text(1000),
});

export const invoiceInputSchema = z
  .object({
    serviceCode: service,
    observation,
    amount: money,
    invoiceDate: requiredIsoDate,
    dueDate: requiredIsoDate,
    notes: text(1000),
    requiresAcknowledgment: z
      .union([z.literal("on"), z.literal("true"), z.literal("")])
      .optional()
      .transform((v) => v === "on" || v === "true"),
  })
  .refine((v) => v.dueDate >= v.invoiceDate, {
    message: "due date cannot be before the invoice date",
    path: ["dueDate"],
  });

export type AuthorizationInput = z.infer<typeof authorizationInputSchema>;
export type CompletionInput = z.infer<typeof completionInputSchema>;
export type InvoiceInput = z.infer<typeof invoiceInputSchema>;

const FIELD_LABELS: Record<string, string> = {
  serviceCode: "Service",
  observation: "Observation",
  estimatedAmount: "Estimated amount",
  amount: "Amount",
  startDate: "Start date",
  targetDate: "Target completion",
  completionDate: "Completion date",
  invoiceDate: "Invoice date",
  dueDate: "Due date",
  poNumber: "PO / approval #",
  paymentMethod: "Payment method",
  notes: "Notes",
  signerName: "Printed name",
  signerTitle: "Title",
  exceptions: "Exceptions",
  amountDollars: "Amount",
  paidAt: "Payment date",
  reference: "Reference",
  method: "Payment method",
  name: "Name",
  email: "Email",
  phone: "Phone",
  make: "Make",
  model: "Model",
  vin: "VIN",
  year: "Year",
};

/** Parse untyped form data, turning the first zod issue into a readable AppError. */
export function parseInput<T extends z.ZodTypeAny>(schema: T, raw: unknown): z.output<T> {
  const result = schema.safeParse(raw);
  if (result.success) return result.data;
  const issue = result.error.issues[0];
  const field = issue.path[0] !== undefined ? String(issue.path[0]) : "";
  const label = FIELD_LABELS[field] ?? field;
  throw new AppError(label ? `${label}: ${issue.message}` : issue.message, "invalid");
}
