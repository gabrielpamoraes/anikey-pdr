/**
 * Starting texts for a new organization. They are editable in Settings and are snapshotted into each
 * document when it is created, so changing them later never alters a document already issued.
 * Replace with the exact wording from the company's own forms.
 */
export const DEFAULT_TERMS_AUTHORIZATION = [
  "1. Authorization. The customer named above authorizes the company to perform the hail damage repair described in this document on the vehicle identified above.",
  "2. Estimate. The amount shown is an estimate. Additional or changed work requires the customer's approval before it is performed, and a revised authorization will be issued for signature.",
  "3. Payment. Payment is due within {{paymentTermsDays}} calendar days after completion unless otherwise agreed in writing. A delay in payment by an insurer or other third party does not extend the due date.",
  "4. Vehicle condition. Pre-existing damage not listed in this document is not part of this authorization.",
].join("\n");

export const DEFAULT_TERMS_ACCEPTANCE = [
  "By signing, the customer confirms that the vehicle was available for inspection and that the work listed in this document has been completed.",
  "The customer accepts the visible workmanship at delivery, except for any exceptions written in the punch list below.",
  "Signing this document does not change the invoice due date.",
].join("\n");

export const DEFAULT_TERMS_INVOICE = [
  "Payment is due within {{paymentTermsDays}} calendar days of the completion date.",
  "A delay in payment by an insurer or other third party does not extend the due date.",
].join("\n");

export const DEFAULT_REMITTANCE = [
  "Payable to the company named above.",
  "Accepted: ACH, check. Reference the invoice number and VIN or Stock # with your payment.",
].join("\n");

export const DEFAULT_SERVICE_TYPES: { code: string; label: string }[] = [
  { code: "FULL_CAR", label: "Full car" },
  { code: "NO_HOOD", label: "No hood" },
  { code: "ROOF_PUSH_TO_PAINT", label: "Roof push to paint" },
];
