import { db } from "@/lib/db";
import { AppError } from "@/lib/errors";
import { DUMMY_HASH, hashPassword, verifyPassword } from "@/lib/password";
import { rateLimit } from "@/lib/rate-limit";
import type { Actor, Role } from "@/domain/types";
import { recordAudit } from "./audit";

export interface SessionUser {
  id: string;
  orgId: string;
  name: string;
  email: string;
  role: Role;
}

/** Checks credentials. The same message is returned for an unknown e-mail and a wrong password. */
export async function authenticate(email: string, password: string, meta: { ip?: string | null; userAgent?: string | null }): Promise<SessionUser> {
  const normalized = email.trim().toLowerCase();
  if (!rateLimit(`login:ip:${meta.ip ?? "unknown"}`, 20, 15 * 60_000) || !rateLimit(`login:email:${normalized}`, 8, 15 * 60_000)) {
    throw new AppError("Too many attempts. Please wait a few minutes and try again.", "rate_limited");
  }
  const user = await db.user.findUnique({ where: { email: normalized } });
  const ok = await verifyPassword(password, user?.passwordHash ?? DUMMY_HASH);
  if (!user || !user.active || !ok) throw new AppError("Invalid email or password.", "forbidden");

  await db.$transaction(async (tx) => {
    await tx.user.update({ where: { id: user.id }, data: { lastLoginAt: new Date() } });
    await recordAudit(tx, {
      orgId: user.orgId,
      actorType: "USER",
      actorId: user.id,
      actorLabel: user.name,
      action: "user.login",
      entityType: "User",
      entityId: user.id,
      ip: meta.ip ?? null,
      userAgent: meta.userAgent ?? null,
    });
  });
  return { id: user.id, orgId: user.orgId, name: user.name, email: user.email, role: user.role };
}

export async function getActiveUser(userId: string): Promise<SessionUser | null> {
  const user = await db.user.findUnique({ where: { id: userId } });
  if (!user || !user.active) return null;
  return { id: user.id, orgId: user.orgId, name: user.name, email: user.email, role: user.role };
}

export function toActor(user: SessionUser, meta: { ip?: string | null; userAgent?: string | null } = {}): Actor {
  return { orgId: user.orgId, userId: user.id, userName: user.name, role: user.role, ip: meta.ip ?? null, userAgent: meta.userAgent ?? null };
}

export async function createUser(input: { orgId: string; email: string; name: string; password: string; role: Role }) {
  return db.user.create({
    data: {
      orgId: input.orgId,
      email: input.email.trim().toLowerCase(),
      name: input.name,
      role: input.role,
      passwordHash: await hashPassword(input.password),
    },
  });
}
