import { describe, expect, it } from "vitest";
import { canStartDocument, currentVersion, deriveJobStatus, hasBeenSigned, type VersionLite } from "@/domain/job-status";

const v = (type: VersionLite["type"], version: number, status: VersionLite["status"]): VersionLite => ({ type, version, status });
const derive = (versions: VersionLite[], extra: Partial<{ cancelled: boolean; invoiceAmountCents: number | null; paidCents: number }> = {}) =>
  deriveJobStatus({ cancelled: false, invoiceAmountCents: null, paidCents: 0, versions, ...extra });

describe("deriveJobStatus", () => {
  it("walks through the happy path", () => {
    expect(derive([])).toBe("AWAITING_AUTHORIZATION");
    expect(derive([v("AUTHORIZATION", 1, "DRAFT")])).toBe("AWAITING_AUTHORIZATION");
    expect(derive([v("AUTHORIZATION", 1, "SENT")])).toBe("AWAITING_AUTHORIZATION");
    const authSigned = v("AUTHORIZATION", 1, "SIGNED");
    expect(derive([authSigned])).toBe("IN_PROGRESS");
    expect(derive([authSigned, v("COMPLETION", 1, "DRAFT")])).toBe("IN_PROGRESS");
    expect(derive([authSigned, v("COMPLETION", 1, "SENT")])).toBe("AWAITING_ACCEPTANCE");
    const done = [authSigned, v("COMPLETION", 1, "SIGNED")];
    expect(derive(done)).toBe("READY_TO_INVOICE");
    expect(derive([...done, v("INVOICE", 1, "DRAFT")])).toBe("READY_TO_INVOICE");
    expect(derive([...done, v("INVOICE", 1, "SENT")], { invoiceAmountCents: 100 })).toBe("INVOICED");
    expect(derive([...done, v("INVOICE", 1, "SENT")], { invoiceAmountCents: 100, paidCents: 40 })).toBe("INVOICED");
    expect(derive([...done, v("INVOICE", 1, "SENT")], { invoiceAmountCents: 100, paidCents: 100 })).toBe("PAID");
    expect(derive([...done, v("INVOICE", 1, "SIGNED")], { invoiceAmountCents: 100, paidCents: 150 })).toBe("PAID");
  });
  it("cancelled wins over everything", () => {
    expect(derive([v("AUTHORIZATION", 1, "SIGNED")], { cancelled: true })).toBe("CANCELLED");
  });
  it("a zero or missing invoice amount is never 'paid'", () => {
    const all = [v("AUTHORIZATION", 1, "SIGNED"), v("COMPLETION", 1, "SIGNED"), v("INVOICE", 1, "SENT")];
    expect(derive(all, { invoiceAmountCents: 0, paidCents: 0 })).toBe("INVOICED");
    expect(derive(all, { invoiceAmountCents: null, paidCents: 10 })).toBe("INVOICED");
  });
  it("uses the newest non-void version of each document", () => {
    const versions = [v("AUTHORIZATION", 1, "SUPERSEDED"), v("AUTHORIZATION", 2, "SIGNED"), v("AUTHORIZATION", 3, "VOID")];
    expect(currentVersion(versions, "AUTHORIZATION")?.version).toBe(2);
    expect(derive(versions)).toBe("IN_PROGRESS");
    // a revision in progress sends the job back to awaiting authorization
    expect(derive([v("AUTHORIZATION", 1, "SIGNED"), v("AUTHORIZATION", 2, "DRAFT")])).toBe("AWAITING_AUTHORIZATION");
    expect(currentVersion([v("AUTHORIZATION", 1, "VOID")], "AUTHORIZATION")).toBeNull();
  });
});

describe("document order", () => {
  it("requires the previous document to have been signed", () => {
    expect(canStartDocument("AUTHORIZATION", [], true)).toEqual({ ok: true });
    expect(canStartDocument("COMPLETION", [], true)).toMatchObject({ ok: false });
    expect(canStartDocument("COMPLETION", [v("AUTHORIZATION", 1, "SENT")], true)).toMatchObject({ ok: false });
    expect(canStartDocument("COMPLETION", [v("AUTHORIZATION", 1, "SIGNED")], true)).toEqual({ ok: true });
    expect(canStartDocument("COMPLETION", [v("AUTHORIZATION", 1, "SUPERSEDED"), v("AUTHORIZATION", 2, "SIGNED")], true)).toEqual({ ok: true });
    expect(canStartDocument("INVOICE", [v("AUTHORIZATION", 1, "SIGNED")], true)).toMatchObject({ ok: false });
    expect(canStartDocument("INVOICE", [v("COMPLETION", 1, "SIGNED")], true)).toEqual({ ok: true });
  });
  it("can be switched off", () => {
    expect(canStartDocument("INVOICE", [], false)).toEqual({ ok: true });
    expect(hasBeenSigned([v("COMPLETION", 1, "SENT")], "COMPLETION")).toBe(false);
  });
});
