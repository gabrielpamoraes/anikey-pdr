"use server";
import { AppError } from "@/lib/errors";
import { getRequestMeta } from "@/lib/session";
import { signByToken } from "@/services/signing";

export type SignOutcome = { ok: true } | { ok: false; error: string };

/** Called directly from the client form so the drawn signature is not lost when validation fails. */
export async function signAction(token: string, data: { signerName: string; signerTitle: string; authorityConfirmed: boolean; exceptions: string; signatureDataUrl: string }): Promise<SignOutcome> {
  try {
    await signByToken(
      token,
      { signerName: data.signerName, signerTitle: data.signerTitle, authorityConfirmed: data.authorityConfirmed ? "on" : undefined, exceptions: data.exceptions, signatureDataUrl: data.signatureDataUrl },
      await getRequestMeta(),
    );
    return { ok: true };
  } catch (e) {
    if (e instanceof AppError) return { ok: false, error: e.message };
    throw e;
  }
}
