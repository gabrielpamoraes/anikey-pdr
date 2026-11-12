import { describe, expect, it } from "vitest";
import { AppError } from "@/lib/errors";
import { authorizationInputSchema, completionInputSchema, invoiceInputSchema, parseInput } from "@/domain/payloads";
import { formatNumber, renderTerms } from "@/domain/numbering";
import { vehicleInputSchema } from "@/services/jobs";
import { signInputSchema } from "@/services/signing";

const auth = { serviceCode: "FULL_CAR", observation: " Pull paint rail right ", estimatedAmount: "1,200", startDate: "2026-10-20", targetDate: "", poNumber: "", paymentMethod: "" };

describe("document input", () => {
  it("normalizes a valid authorization", () => {
    expect(parseInput(authorizationInputSchema, auth)).toEqual({
      serviceCode: "FULL_CAR",
      observation: "Pull paint rail right",
      estimatedAmount: 120000,
      startDate: "2026-10-20",
      targetDate: null,
      poNumber: null,
      paymentMethod: null,
    });
  });
  it("reports the first problem with the field's label", () => {
    const fail = (raw: unknown, schema: Parameters<typeof parseInput>[0]) => {
      try {
        parseInput(schema, raw);
      } catch (e) {
        expect(e).toBeInstanceOf(AppError);
        return (e as AppError).message;
      }
      throw new Error("expected a failure");
    };
    expect(fail({ ...auth, estimatedAmount: "0" }, authorizationInputSchema)).toMatch(/^Estimated amount: /);
    expect(fail({ ...auth, serviceCode: "" }, authorizationInputSchema)).toMatch(/^Service: choose a service/);
    expect(fail({ ...auth, paymentMethod: "BITCOIN" }, authorizationInputSchema)).toMatch(/^Payment method: /);
    expect(fail({ serviceCode: "X", completionDate: "nope", notes: "" }, completionInputSchema)).toMatch(/^Completion date: /);
    expect(fail({ serviceCode: "X", amount: "10", invoiceDate: "2026-10-24", dueDate: "2026-10-01", notes: "" }, invoiceInputSchema)).toMatch(/due date cannot be before/);
  });
  it("reads the acknowledgment checkbox", () => {
    const base = { serviceCode: "X", amount: "10", invoiceDate: "2026-10-24", dueDate: "2026-11-07", notes: "" };
    expect(parseInput(invoiceInputSchema, { ...base, requiresAcknowledgment: "on" }).requiresAcknowledgment).toBe(true);
    expect(parseInput(invoiceInputSchema, base).requiresAcknowledgment).toBe(false);
  });
});

describe("other inputs", () => {
  it("vehicle: VIN and year", () => {
    expect(parseInput(vehicleInputSchema, { year: "2022", make: "Toyota", model: "Camry", vin: "4t1g11ak0nu123456" }).vin).toBe("4T1G11AK0NU123456");
    expect(() => parseInput(vehicleInputSchema, { make: "A", model: "B", vin: "I0I0I0I0I0I0I0I0I" })).toThrow(/VIN/);
    expect(() => parseInput(vehicleInputSchema, { make: "A", model: "B", year: "1850" })).toThrow(/Year/);
    expect(parseInput(vehicleInputSchema, { make: "A", model: "B" })).toMatchObject({ year: null, vin: null });
  });
  it("signature form", () => {
    const ok = { signerName: "Casey Buyer", signerTitle: "", authorityConfirmed: "on", signatureDataUrl: "data:image/png;base64,xx", exceptions: " none " };
    expect(parseInput(signInputSchema, ok)).toMatchObject({ signerTitle: null, exceptions: "none" });
    expect(() => parseInput(signInputSchema, { ...ok, authorityConfirmed: undefined })).toThrow(/authorized to sign/);
    expect(() => parseInput(signInputSchema, { ...ok, signerName: "A" })).toThrow(/Printed name/);
  });
});

describe("numbering and terms", () => {
  it("formats numbers", () => {
    expect(formatNumber("INV", 2026, 1)).toBe("INV-2026-0001");
    expect(formatNumber("WA", 2027, 12345)).toBe("WA-2027-12345");
  });
  it("fills placeholders and leaves unknown ones alone", () => {
    expect(renderTerms("Due in {{paymentTermsDays}} days {{ other }}", { paymentTermsDays: 14 })).toBe("Due in 14 days {{ other }}");
  });
});
