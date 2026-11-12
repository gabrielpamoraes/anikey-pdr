import { PDFDocument, PDFFont, PDFImage, PDFPage, StandardFonts, rgb } from "pdf-lib";
import { formatDateTimeUS, formatDateUS } from "@/lib/dates";
import { formatUsd } from "@/lib/money";
import { DOC_LABELS, PAYMENT_METHOD_LABELS } from "@/domain/labels";
import type { DocumentPayload } from "@/domain/payloads";
import type { VersionStatus } from "@/domain/types";

export interface PdfSignature {
  signerName: string;
  signerTitle: string | null;
  signedAt: Date;
  ip: string | null;
  png: Uint8Array;
  exceptions: string | null;
  authorityConfirmed: boolean;
}

export interface PdfInput {
  number: string;
  version: number;
  status: VersionStatus;
  payload: DocumentPayload;
  contentHash: string | null;
  timeZone: string;
  signature?: PdfSignature | null;
}

const PAGE_W = 612;
const PAGE_H = 792;
const MARGIN = 48;
const CONTENT_W = PAGE_W - MARGIN * 2;

const INK = rgb(0.067, 0.094, 0.153);
const MUTED = rgb(0.357, 0.396, 0.451);
const RULE = rgb(0.82, 0.84, 0.87);
const ACCENT = rgb(0.76, 0.255, 0.047);
const RED = rgb(0.6, 0.106, 0.106);

/** Standard PDF fonts only encode WinAnsi; replace anything else so rendering can never throw. */
const WIN_ANSI_EXTRA = "€‚ƒ„…†‡ˆ‰Š‹ŒŽ‘’“”•–—˜™š›œžŸ";
export function toWinAnsi(input: string): string {
  let out = "";
  for (const ch of input.replace(/\t/g, " ")) {
    const code = ch.codePointAt(0)!;
    if (ch === "\n" || (code >= 0x20 && code <= 0x7e) || (code >= 0xa0 && code <= 0xff) || WIN_ANSI_EXTRA.includes(ch)) {
      out += ch;
    } else if (code === 0x2192) {
      out += "->";
    } else {
      out += "?";
    }
  }
  return out;
}

class Cursor {
  page: PDFPage;
  y: number;
  constructor(
    private readonly doc: PDFDocument,
    readonly font: PDFFont,
    readonly bold: PDFFont,
  ) {
    this.page = doc.addPage([PAGE_W, PAGE_H]);
    this.y = PAGE_H - MARGIN;
  }

  ensure(height: number) {
    if (this.y - height < MARGIN + 28) {
      this.page = this.doc.addPage([PAGE_W, PAGE_H]);
      this.y = PAGE_H - MARGIN;
    }
  }

  wrap(text: string, font: PDFFont, size: number, maxWidth: number): string[] {
    const lines: string[] = [];
    for (const paragraph of toWinAnsi(text).split("\n")) {
      if (paragraph.trim() === "") {
        lines.push("");
        continue;
      }
      let line = "";
      for (const word of paragraph.split(" ")) {
        // Break words longer than the line.
        let w = word;
        while (font.widthOfTextAtSize(w, size) > maxWidth) {
          let cut = w.length - 1;
          while (cut > 1 && font.widthOfTextAtSize(w.slice(0, cut), size) > maxWidth) cut--;
          if (line) {
            lines.push(line);
            line = "";
          }
          lines.push(w.slice(0, cut));
          w = w.slice(cut);
        }
        const candidate = line ? `${line} ${w}` : w;
        if (font.widthOfTextAtSize(candidate, size) <= maxWidth) line = candidate;
        else {
          lines.push(line);
          line = w;
        }
      }
      lines.push(line);
    }
    return lines;
  }

  /** Draw wrapped text at x, advancing y. Returns the number of lines drawn. */
  paragraph(
    text: string,
    opts: { x?: number; width?: number; size?: number; bold?: boolean; color?: ReturnType<typeof rgb>; gap?: number } = {},
  ): number {
    const size = opts.size ?? 10;
    const font = opts.bold ? this.bold : this.font;
    const x = opts.x ?? MARGIN;
    const width = opts.width ?? CONTENT_W - (x - MARGIN);
    const lineH = size * 1.4;
    const lines = this.wrap(text, font, size, width);
    for (const line of lines) {
      this.ensure(lineH);
      this.y -= lineH;
      if (line) this.page.drawText(line, { x, y: this.y + size * 0.28, size, font, color: opts.color ?? INK });
    }
    this.y -= opts.gap ?? 0;
    return lines.length;
  }

  rule(gapAfter = 10) {
    this.ensure(gapAfter + 2);
    this.page.drawLine({ start: { x: MARGIN, y: this.y }, end: { x: PAGE_W - MARGIN, y: this.y }, thickness: 0.75, color: RULE });
    this.y -= gapAfter;
  }

  space(h: number) {
    this.y -= h;
  }
}

function labelValue(c: Cursor, label: string, value: string | null | undefined, x: number, width: number) {
  c.paragraph(label.toUpperCase(), { x, width, size: 7.5, bold: true, color: MUTED });
  c.paragraph(value && value.trim() ? value : "-", { x, width, size: 10, gap: 4 });
}

export async function renderDocumentPdf(input: PdfInput): Promise<Uint8Array> {
  const { payload } = input;
  const doc = await PDFDocument.create();
  const font = await doc.embedFont(StandardFonts.Helvetica);
  const bold = await doc.embedFont(StandardFonts.HelveticaBold);
  doc.setTitle(`${DOC_LABELS[payload.type]} ${input.number}`);
  doc.setAuthor(payload.issuer.name);
  doc.setProducer("ANIKEY PDR");
  doc.setCreator("ANIKEY PDR");
  const stamp = input.signature?.signedAt ?? new Date();
  doc.setCreationDate(stamp);
  doc.setModificationDate(stamp);

  const c = new Cursor(doc, font, bold);

  /* ---- Header ---- */
  c.paragraph(payload.issuer.name.toUpperCase(), { size: 9, bold: true, color: MUTED });
  const headerBottom = c.y;
  c.paragraph(DOC_LABELS[payload.type], { size: 20, bold: true, gap: 2 });
  // Number block on the right of the title
  c.page.drawText(toWinAnsi(input.number), {
    x: PAGE_W - MARGIN - bold.widthOfTextAtSize(toWinAnsi(input.number), 12),
    y: headerBottom - 20,
    size: 12,
    font: bold,
    color: INK,
  });
  const versionLabel = `Version ${input.version}`;
  c.page.drawText(versionLabel, {
    x: PAGE_W - MARGIN - font.widthOfTextAtSize(versionLabel, 9),
    y: headerBottom - 33,
    size: 9,
    font,
    color: MUTED,
  });
  const contact = [payload.issuer.phone, payload.issuer.email, payload.issuer.addressLine].filter(Boolean).join("  |  ");
  if (contact) c.paragraph(contact, { size: 8.5, color: MUTED });

  const needsSignature = payload.type !== "INVOICE" || payload.requiresAcknowledgment;
  if (input.status === "DRAFT") {
    c.paragraph("DRAFT - NOT YET SENT FOR SIGNATURE", { size: 9, bold: true, color: RED });
  } else if (!input.signature && needsSignature) {
    c.paragraph("AWAITING CUSTOMER SIGNATURE", { size: 9, bold: true, color: ACCENT });
  } else if (input.status === "SUPERSEDED") {
    c.paragraph("SUPERSEDED BY A NEWER VERSION", { size: 9, bold: true, color: RED });
  }
  c.space(6);
  c.rule(12);

  /* ---- Customer / Vehicle ---- */
  const colW = (CONTENT_W - 24) / 2;
  const startY = c.y;
  const customer = payload.customer;
  labelValue(c, "Customer", customer.name, MARGIN, colW);
  labelValue(c, "Contact", [customer.contactName, customer.contactTitle].filter(Boolean).join(", "), MARGIN, colW);
  labelValue(c, "Email / Phone", [customer.contactEmail, customer.phone].filter(Boolean).join("  |  "), MARGIN, colW);
  if (customer.address) labelValue(c, "Address", customer.address, MARGIN, colW);
  const leftEnd = c.y;

  c.y = startY;
  const v = payload.vehicle;
  const vx = MARGIN + colW + 24;
  labelValue(c, "Vehicle", [v.year, v.make, v.model].filter(Boolean).join(" "), vx, colW);
  labelValue(c, "VIN", v.vin, vx, colW);
  labelValue(c, "Color / Plate", [v.color, v.licensePlate].filter(Boolean).join("  |  "), vx, colW);
  labelValue(c, "Stock / RO #", v.referenceNumber, vx, colW);
  c.y = Math.min(leftEnd, c.y);
  c.space(4);
  c.rule(12);

  /* ---- Service ---- */
  c.paragraph("HAIL REPAIR SERVICE", { size: 7.5, bold: true, color: MUTED });
  c.paragraph(payload.serviceLabel, { size: 13, bold: true, gap: 4 });
  if (payload.observation.trim()) {
    c.paragraph("OBSERVATION", { size: 7.5, bold: true, color: MUTED });
    c.paragraph(payload.observation, { size: 10, gap: 4 });
  }

  /* ---- Document specifics ---- */
  c.space(4);
  if (payload.type === "AUTHORIZATION") {
    c.rule(10);
    const w3 = (CONTENT_W - 32) / 3;
    const y0 = c.y;
    labelValue(c, "Estimated amount", formatUsd(payload.estimatedAmountCents), MARGIN, w3);
    const yA = c.y;
    c.y = y0;
    labelValue(c, "Start date", formatDateUS(payload.startDate), MARGIN + w3 + 16, w3);
    c.y = y0;
    labelValue(c, "Target completion", payload.targetDate ? formatDateUS(payload.targetDate) : "-", MARGIN + (w3 + 16) * 2, w3);
    c.y = Math.min(yA, c.y);
    const y1 = c.y;
    labelValue(c, "PO / approval #", payload.poNumber, MARGIN, w3);
    const yB = c.y;
    c.y = y1;
    labelValue(c, "Payment method", payload.paymentMethod ? PAYMENT_METHOD_LABELS[payload.paymentMethod] : null, MARGIN + w3 + 16, w3);
    c.y = y1;
    labelValue(c, "Payment terms", `Net ${payload.paymentTermsDays} days`, MARGIN + (w3 + 16) * 2, w3);
    c.y = Math.min(yB, c.y);
  } else if (payload.type === "COMPLETION") {
    c.rule(10);
    const w2 = (CONTENT_W - 24) / 2;
    const y0 = c.y;
    labelValue(c, "Completion date", formatDateUS(payload.completionDate), MARGIN, w2);
    const yA = c.y;
    c.y = y0;
    labelValue(c, "Work authorization #", payload.authorizationNumber, MARGIN + w2 + 24, w2);
    c.y = Math.min(yA, c.y);
    if (payload.notes) labelValue(c, "Notes", payload.notes, MARGIN, CONTENT_W);
  } else {
    c.rule(10);
    const w3 = (CONTENT_W - 32) / 3;
    const y0 = c.y;
    labelValue(c, "Invoice date", formatDateUS(payload.invoiceDate), MARGIN, w3);
    const yA = c.y;
    c.y = y0;
    labelValue(c, "Due date", formatDateUS(payload.dueDate), MARGIN + w3 + 16, w3);
    c.y = y0;
    labelValue(c, "Payment terms", `Net ${payload.paymentTermsDays} days`, MARGIN + (w3 + 16) * 2, w3);
    c.y = Math.min(yA, c.y);
    const refs = [
      payload.authorizationNumber ? `Authorization ${payload.authorizationNumber}` : null,
      payload.completionNumber ? `Completion ${payload.completionNumber}` : null,
    ]
      .filter(Boolean)
      .join("  |  ");
    if (refs) labelValue(c, "References", refs, MARGIN, CONTENT_W);

    // Amount table
    c.space(4);
    c.ensure(60);
    const tableTop = c.y;
    c.page.drawRectangle({ x: MARGIN, y: tableTop - 22, width: CONTENT_W, height: 22, color: rgb(0.953, 0.957, 0.965) });
    c.page.drawText("DESCRIPTION", { x: MARGIN + 8, y: tableTop - 15, size: 8, font: bold, color: MUTED });
    const amountHeader = "AMOUNT";
    c.page.drawText(amountHeader, { x: PAGE_W - MARGIN - 8 - bold.widthOfTextAtSize(amountHeader, 8), y: tableTop - 15, size: 8, font: bold, color: MUTED });
    c.y = tableTop - 22;
    const desc = payload.observation.trim() ? `${payload.serviceLabel} - ${payload.observation}` : payload.serviceLabel;
    const descLines = c.wrap(desc, font, 10, CONTENT_W - 130);
    const rowH = descLines.length * 14 + 12;
    c.ensure(rowH + 40);
    let ly = c.y - 16;
    for (const l of descLines) {
      c.page.drawText(l, { x: MARGIN + 8, y: ly, size: 10, font, color: INK });
      ly -= 14;
    }
    const amt = formatUsd(payload.amountCents);
    c.page.drawText(amt, { x: PAGE_W - MARGIN - 8 - font.widthOfTextAtSize(amt, 10), y: c.y - 16, size: 10, font, color: INK });
    c.y -= rowH;
    c.rule(8);
    const totalLabel = "TOTAL DUE";
    const total = formatUsd(payload.amountCents);
    c.page.drawText(totalLabel, { x: PAGE_W - MARGIN - 8 - 150, y: c.y - 12, size: 9, font: bold, color: MUTED });
    c.page.drawText(total, { x: PAGE_W - MARGIN - 8 - bold.widthOfTextAtSize(total, 15), y: c.y - 14, size: 15, font: bold, color: INK });
    c.y -= 28;
    if (payload.notes) {
      c.paragraph("NOTES / PO", { size: 7.5, bold: true, color: MUTED });
      c.paragraph(payload.notes, { size: 10, gap: 4 });
    }
    c.paragraph("PAYMENT / REMITTANCE", { size: 7.5, bold: true, color: MUTED });
    c.paragraph(payload.remittance, { size: 9.5, gap: 4 });
  }

  /* ---- Terms ---- */
  c.space(4);
  c.rule(10);
  c.paragraph("TERMS", { size: 7.5, bold: true, color: MUTED });
  c.paragraph(payload.terms, { size: 8.5, color: INK, gap: 6 });

  /* ---- Signature ---- */
  c.space(6);
  c.ensure(150);
  c.rule(10);
  const sig = input.signature;
  if (sig) {
    c.paragraph("SIGNED ELECTRONICALLY", { size: 7.5, bold: true, color: MUTED });
    let image: PDFImage | null = null;
    try {
      image = await doc.embedPng(sig.png);
    } catch {
      image = null;
    }
    const boxW = 230;
    const boxH = 80;
    const boxTop = c.y;
    c.page.drawRectangle({ x: MARGIN, y: boxTop - boxH, width: boxW, height: boxH, borderColor: RULE, borderWidth: 0.75, color: rgb(1, 1, 1) });
    if (image) {
      const scale = Math.min((boxW - 12) / image.width, (boxH - 12) / image.height);
      const w = image.width * scale;
      const h = image.height * scale;
      c.page.drawImage(image, { x: MARGIN + (boxW - w) / 2, y: boxTop - boxH + (boxH - h) / 2, width: w, height: h });
    }
    const infoX = MARGIN + boxW + 20;
    const infoW = CONTENT_W - boxW - 20;
    c.y = boxTop;
    labelValue(c, "Signed by", [sig.signerName, sig.signerTitle].filter(Boolean).join(", "), infoX, infoW);
    labelValue(c, "Date and time", formatDateTimeUS(sig.signedAt, input.timeZone), infoX, infoW);
    labelValue(c, "IP address", sig.ip, infoX, infoW);
    c.y = Math.min(c.y, boxTop - boxH);
    c.space(6);
    if (sig.authorityConfirmed) {
      c.paragraph("The signer confirmed they have authority to sign on behalf of the customer.", { size: 8.5, color: MUTED, gap: 4 });
    }
    if (payload.type === "COMPLETION") {
      c.paragraph("CUSTOMER EXCEPTIONS / PUNCH LIST", { size: 7.5, bold: true, color: MUTED });
      c.paragraph(sig.exceptions?.trim() ? sig.exceptions : "None noted.", { size: 10, gap: 4 });
    }
  } else if (needsSignature) {
    c.paragraph("CUSTOMER SIGNATURE", { size: 7.5, bold: true, color: MUTED });
    c.space(34);
    c.page.drawLine({ start: { x: MARGIN, y: c.y }, end: { x: MARGIN + 260, y: c.y }, thickness: 0.75, color: INK });
    c.page.drawLine({ start: { x: MARGIN + 290, y: c.y }, end: { x: MARGIN + 420, y: c.y }, thickness: 0.75, color: INK });
    c.space(4);
    c.paragraph("Printed name, title and signature", { size: 8, color: MUTED });
  } else {
    c.paragraph("No customer signature is required for this invoice.", { size: 9, color: MUTED });
  }

  if (input.contentHash) {
    c.space(8);
    c.paragraph(`Document fingerprint (SHA-256): ${input.contentHash}`, { size: 7, color: MUTED });
  }

  /* ---- Footer on every page ---- */
  const pages = doc.getPages();
  pages.forEach((page, i) => {
    const footer = toWinAnsi(`${payload.issuer.name}  |  ${input.number}  |  v${input.version}`);
    page.drawText(footer, { x: MARGIN, y: 28, size: 7.5, font, color: MUTED });
    const pageLabel = `Page ${i + 1} of ${pages.length}`;
    page.drawText(pageLabel, { x: PAGE_W - MARGIN - font.widthOfTextAtSize(pageLabel, 7.5), y: 28, size: 7.5, font, color: MUTED });
  });

  return doc.save();
}
