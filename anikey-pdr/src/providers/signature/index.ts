import { AppError } from "@/lib/errors";
import { sha256Hex } from "@/lib/crypto";

export interface CapturedSignature {
  png: Uint8Array;
  sha256: string;
}

/**
 * Signature capture is behind an interface so an external e-sign service can replace it later.
 *
 * - `internal` (default): the signer draws on their phone; we keep the PNG plus an evidence record
 *   (name, title, timestamp, IP, user agent, content hash) and stamp it into the signed PDF.
 * - A DocuSign / Dropbox Sign provider would create an envelope from the rendered PDF, receive the
 *   completion webhook, and call the same `signingService` completion path with the provider's
 *   certificate attached as evidence (see docs/ARCHITECTURE.md).
 */
export interface SignatureProvider {
  readonly name: string;
  capture(dataUrl: string): CapturedSignature;
}

const MAX_BYTES = 400 * 1024;
const PNG_MAGIC = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];

export class InternalSignatureProvider implements SignatureProvider {
  readonly name = "internal";

  capture(dataUrl: string): CapturedSignature {
    const match = /^data:image\/png;base64,([A-Za-z0-9+/=]+)$/.exec(dataUrl.trim());
    if (!match) throw new AppError("Signature: please sign in the box.");
    const png = new Uint8Array(Buffer.from(match[1], "base64"));
    if (png.length < 100 || png.length > MAX_BYTES) throw new AppError("Signature: the image is not valid.");
    if (!PNG_MAGIC.every((b, i) => png[i] === b)) throw new AppError("Signature: the image is not valid.");
    return { png, sha256: sha256Hex(png) };
  }
}

let instance: SignatureProvider = new InternalSignatureProvider();

export function getSignatureProvider(): SignatureProvider {
  return instance;
}

/** Test / future-integration seam. */
export function setSignatureProvider(provider: SignatureProvider): void {
  instance = provider;
}
