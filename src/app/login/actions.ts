"use server";
import { redirect } from "next/navigation";
import { AppError } from "@/lib/errors";
import { withFlash, str } from "@/lib/flash";
import { endSession, getRequestMeta, startSession } from "@/lib/session";
import { authenticate } from "@/services/auth";

export async function loginAction(form: FormData) {
  try {
    const user = await authenticate(str(form, "email"), str(form, "password"), await getRequestMeta());
    await startSession(user.id);
  } catch (e) {
    if (e instanceof AppError) redirect(withFlash("/login", "error", e.message));
    throw e;
  }
  redirect("/jobs");
}

export async function logoutAction() {
  await endSession();
  redirect("/login");
}
