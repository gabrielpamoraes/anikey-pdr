import { redirect } from "next/navigation";
import { AppError } from "@/lib/errors";

/** Appends a flash message to a path as a query parameter. */
export function withFlash(path: string, kind: "error" | "notice", message: string): string {
  const [base, hash] = path.split("#");
  const sep = base.includes("?") ? "&" : "?";
  return `${base}${sep}${kind}=${encodeURIComponent(message)}${hash ? `#${hash}` : ""}`;
}

/**
 * Runs a server action body. Domain errors (AppError) become an error banner on `back`;
 * anything else is a bug and propagates. `fn` may return a path to go to (with an optional notice).
 */
export async function guard(back: string, fn: () => Promise<{ to?: string; notice?: string } | void>): Promise<never> {
  let result: { to?: string; notice?: string } | void;
  try {
    result = await fn();
  } catch (e) {
    if (e instanceof AppError) redirect(withFlash(back, "error", e.message));
    throw e;
  }
  const to = result?.to ?? back;
  redirect(result?.notice ? withFlash(to, "notice", result.notice) : to);
}

export function str(form: FormData, key: string): string {
  const v = form.get(key);
  return typeof v === "string" ? v : "";
}

export function formObject(form: FormData): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [k, v] of form.entries()) if (typeof v === "string" && !k.startsWith("$ACTION")) out[k] = v;
  return out;
}
