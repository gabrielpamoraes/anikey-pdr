import { formatDateUS } from "@/lib/dates";
import { DOC_LABELS } from "@/domain/labels";
import type { DocumentPayload } from "@/domain/payloads";
import { getEmail, type EmailAttachment } from "@/providers/email";

function esc(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

function vehicleLine(p: DocumentPayload): string {
  return [p.vehicle.year, p.vehicle.make, p.vehicle.model].filter(Boolean).join(" ");
}

function layout(orgName: string, bodyHtml: string): string {
  return `<div style="font-family:Arial,Helvetica,sans-serif;max-width:560px;margin:0 auto;color:#111827;line-height:1.5">
<div style="font-size:12px;font-weight:700;letter-spacing:.08em;color:#5B6573;margin-bottom:12px">${esc(orgName.toUpperCase())}</div>
${bodyHtml}
</div>`;
}

export async function sendSigningRequestEmail(args: {
  to: string;
  toName: string | null;
  payload: DocumentPayload;
  number: string;
  link: string;
  expiresAt: Date;
  requiresSignature: boolean;
}): Promise<void> {
  const { payload } = args;
  const label = DOC_LABELS[payload.type];
  const action = args.requiresSignature ? "review and sign" : "review";
  const subject = `Please ${action}: ${label} ${args.number} (${vehicleLine(payload)})`;
  const greeting = args.toName ? `Hello ${args.toName},` : "Hello,";
  const text = [
    greeting,
    "",
    `${payload.issuer.name} sent you the ${label} ${args.number} for the ${vehicleLine(payload)}.`,
    `Please ${action} it here:`,
    args.link,
    "",
    `This link is personal to you and expires on ${formatDateUS(args.expiresAt)}.`,
    "",
    payload.issuer.name,
    [payload.issuer.phone, payload.issuer.email].filter(Boolean).join(" | "),
  ].join("\n");
  const html = layout(
    payload.issuer.name,
    `<p>${esc(greeting)}</p>
<p>${esc(payload.issuer.name)} sent you the <strong>${esc(label)} ${esc(args.number)}</strong> for the ${esc(vehicleLine(payload))}.</p>
<p><a href="${esc(args.link)}" style="display:inline-block;background:#C2410C;color:#fff;text-decoration:none;font-weight:700;padding:12px 20px;border-radius:8px">${args.requiresSignature ? "Review and sign" : "View document"}</a></p>
<p style="font-size:13px;color:#5B6573">This link is personal to you and expires on ${esc(formatDateUS(args.expiresAt))}.</p>`,
  );
  await getEmail().send({ to: args.to, subject, text, html });
}

export async function sendSignedConfirmationEmail(args: {
  to: string;
  payload: DocumentPayload;
  number: string;
  signerName: string;
  pdf: Uint8Array | null;
}): Promise<void> {
  const { payload } = args;
  const label = DOC_LABELS[payload.type];
  const attachments: EmailAttachment[] = args.pdf
    ? [{ filename: `${args.number}.pdf`, content: args.pdf, contentType: "application/pdf" }]
    : [];
  const text = [
    `Thank you, ${args.signerName}.`,
    "",
    `The ${label} ${args.number} for the ${vehicleLine(payload)} was signed.`,
    args.pdf ? "A signed copy is attached." : "A signed copy is available from the company on request.",
    "",
    payload.issuer.name,
  ].join("\n");
  const html = layout(
    payload.issuer.name,
    `<p>Thank you, ${esc(args.signerName)}.</p>
<p>The <strong>${esc(label)} ${esc(args.number)}</strong> for the ${esc(vehicleLine(payload))} was signed. ${args.pdf ? "A signed copy is attached." : ""}</p>`,
  );
  await getEmail().send({ to: args.to, subject: `Signed: ${label} ${args.number}`, text, html, attachments });
}

export async function sendStaffSignedEmail(args: {
  to: string;
  payload: DocumentPayload;
  number: string;
  signerName: string;
  jobNumber: string;
  jobLink: string;
}): Promise<void> {
  const label = DOC_LABELS[args.payload.type];
  const text = `${args.signerName} signed the ${label} ${args.number} (${args.jobNumber}, ${vehicleLine(args.payload)}).\n${args.jobLink}`;
  const html = layout(
    args.payload.issuer.name,
    `<p><strong>${esc(args.signerName)}</strong> signed the ${esc(label)} ${esc(args.number)} (${esc(args.jobNumber)}, ${esc(vehicleLine(args.payload))}).</p>
<p><a href="${esc(args.jobLink)}">Open the job</a></p>`,
  );
  await getEmail().send({ to: args.to, subject: `Signed: ${label} ${args.number}`, text, html });
}
