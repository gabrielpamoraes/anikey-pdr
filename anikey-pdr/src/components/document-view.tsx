import { formatDateUS } from "@/lib/dates";
import { formatUsd } from "@/lib/money";
import { DOC_LABELS, PAYMENT_METHOD_LABELS } from "@/domain/labels";
import type { DocumentPayload } from "@/domain/payloads";
import { DL } from "@/components/ui";

/** Read-only rendering of a document payload. Used by staff pages and the customer signing page. */
export function DocumentView({ payload, number, version }: { payload: DocumentPayload; number: string; version: number }) {
  const p = payload;
  const car = [p.vehicle.year, p.vehicle.make, p.vehicle.model].filter(Boolean).join(" ");
  const rows: [string, React.ReactNode][] = [
    ["Customer", p.customer.name],
    ["Contact", [p.customer.contactName, p.customer.contactTitle].filter(Boolean).join(", ") || "-"],
    ["Vehicle", car],
    ["VIN", p.vehicle.vin ?? "-"],
    ["Stock # / RO #", p.vehicle.referenceNumber ?? "-"],
    ["Service", p.serviceLabel],
    ["Observation", p.observation || "-"],
  ];
  if (p.type === "AUTHORIZATION") {
    rows.push(
      ["Estimated amount", <strong key="a">{formatUsd(p.estimatedAmountCents)}</strong>],
      ["Start date", formatDateUS(p.startDate)],
      ["Target completion", p.targetDate ? formatDateUS(p.targetDate) : "-"],
      ["PO / approval #", p.poNumber ?? "-"],
      ["Payment method", p.paymentMethod ? PAYMENT_METHOD_LABELS[p.paymentMethod] : "-"],
    );
  } else if (p.type === "COMPLETION") {
    rows.push(["Authorization", p.authorizationNumber], ["Completion date", formatDateUS(p.completionDate)], ["Notes", p.notes ?? "-"]);
  } else {
    rows.push(
      ["Authorization", p.authorizationNumber],
      ["Completion", p.completionNumber],
      ["Amount due", <strong key="a">{formatUsd(p.amountCents)}</strong>],
      ["Invoice date", formatDateUS(p.invoiceDate)],
      ["Due date", formatDateUS(p.dueDate)],
      ["Notes", p.notes ?? "-"],
    );
  }
  return (
    <div>
      <div className="mb-3 text-sm text-gray-600">
        {DOC_LABELS[p.type]} <span className="font-semibold text-gray-900">{number}</span> · version {version}
      </div>
      <DL rows={rows} />
      <details className="mt-4 text-sm" open={p.type !== "INVOICE"}>
        <summary className="cursor-pointer font-medium text-gray-700">{p.type === "INVOICE" ? "Payment instructions and terms" : "Terms"}</summary>
        {p.type === "INVOICE" && <p className="mt-2 whitespace-pre-line text-gray-800">{p.remittance}</p>}
        <p className="mt-2 whitespace-pre-line text-gray-700">{p.terms}</p>
      </details>
    </div>
  );
}
