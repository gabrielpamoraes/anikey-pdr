import "server-only";
import { cache } from "react";
import { cookies, headers } from "next/headers";
import { redirect } from "next/navigation";
import { SignJWT, jwtVerify } from "jose";
import { authSecret, isProduction } from "@/lib/env";
import { getActiveUser, toActor, type SessionUser } from "@/services/auth";
import type { Actor } from "@/domain/types";

export const SESSION_COOKIE = "anikey_session";
const SESSION_HOURS = 12;

function key(): Uint8Array {
  return new TextEncoder().encode(authSecret());
}

export async function startSession(userId: string): Promise<void> {
  const token = await new SignJWT({})
    .setProtectedHeader({ alg: "HS256" })
    .setSubject(userId)
    .setIssuedAt()
    .setExpirationTime(`${SESSION_HOURS}h`)
    .sign(key());
  (await cookies()).set(SESSION_COOKIE, token, {
    httpOnly: true,
    secure: isProduction(),
    sameSite: "lax",
    path: "/",
    maxAge: SESSION_HOURS * 3600,
  });
}

export async function endSession(): Promise<void> {
  (await cookies()).delete(SESSION_COOKIE);
}

/** The signed-in user for this request, or null. The user row is re-checked so disabling an account takes effect at once. */
export const getSessionUser = cache(async (): Promise<SessionUser | null> => {
  const token = (await cookies()).get(SESSION_COOKIE)?.value;
  if (!token) return null;
  try {
    const { payload } = await jwtVerify(token, key(), { algorithms: ["HS256"] });
    return payload.sub ? await getActiveUser(payload.sub) : null;
  } catch {
    return null;
  }
});

export async function requireUser(): Promise<SessionUser> {
  const user = await getSessionUser();
  if (!user) redirect("/login");
  return user;
}

export async function requireAdmin(): Promise<SessionUser> {
  const user = await requireUser();
  if (user.role !== "ADMIN") redirect("/jobs?error=" + encodeURIComponent("Only an administrator can open that page."));
  return user;
}

export async function getRequestMeta(): Promise<{ ip: string | null; userAgent: string | null }> {
  const h = await headers();
  const forwarded = h.get("x-forwarded-for")?.split(",")[0]?.trim();
  return { ip: forwarded || h.get("x-real-ip") || null, userAgent: h.get("user-agent")?.slice(0, 300) ?? null };
}

/** The acting user plus request details, ready to hand to a service. */
export async function currentActor(): Promise<Actor> {
  const user = await requireUser();
  return toActor(user, await getRequestMeta());
}
