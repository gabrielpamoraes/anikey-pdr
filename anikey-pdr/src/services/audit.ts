import { Prisma } from "@prisma/client";
import { canonicalJson, sha256Hex } from "@/lib/crypto";
import { db, type Tx } from "@/lib/db";
import type { Actor } from "@/domain/types";

/**
 * Append-only audit trail, hash-chained per organization: every entry stores the hash of the previous
 * one, so editing or deleting a past row is detectable (see verifyAuditChain).
 */
export interface AuditEvent {
  orgId: string;
  actorType: "USER" | "CUSTOMER" | "SYSTEM";
  actorId?: string | null;
  actorLabel: string;
  action: string;
  entityType: string;
  entityId: string;
  jobId?: string | null;
  metadata?: Record<string, unknown>;
  ip?: string | null;
  userAgent?: string | null;
}

export function auditForUser(actor: Actor, partial: Omit<AuditEvent, "orgId" | "actorType" | "actorId" | "actorLabel" | "ip" | "userAgent">): AuditEvent {
  return {
    ...partial,
    orgId: actor.orgId,
    actorType: "USER",
    actorId: actor.userId,
    actorLabel: actor.userName,
    ip: actor.ip ?? null,
    userAgent: actor.userAgent ?? null,
  };
}

interface HashedFields {
  prevHash: string | null;
  orgId: string;
  at: string;
  actorType: string;
  actorId: string | null;
  actorLabel: string;
  action: string;
  entityType: string;
  entityId: string;
  jobId: string | null;
  metadata: unknown;
  ip: string | null;
  userAgent: string | null;
}

export function computeAuditHash(fields: HashedFields): string {
  return sha256Hex(canonicalJson(fields));
}

/** Must run inside a transaction: an advisory lock serializes writers so the chain cannot fork. */
export async function recordAudit(tx: Tx, event: AuditEvent): Promise<void> {
  await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${event.orgId}))`;
  const last = await tx.auditLog.findFirst({
    where: { orgId: event.orgId },
    orderBy: { seq: "desc" },
    select: { hash: true },
  });
  const at = new Date();
  const metadata = JSON.parse(JSON.stringify(event.metadata ?? {})) as Prisma.InputJsonObject;
  const fields: HashedFields = {
    prevHash: last?.hash ?? null,
    orgId: event.orgId,
    at: at.toISOString(),
    actorType: event.actorType,
    actorId: event.actorId ?? null,
    actorLabel: event.actorLabel,
    action: event.action,
    entityType: event.entityType,
    entityId: event.entityId,
    jobId: event.jobId ?? null,
    metadata,
    ip: event.ip ?? null,
    userAgent: event.userAgent ?? null,
  };
  await tx.auditLog.create({
    data: {
      orgId: fields.orgId,
      at,
      actorType: fields.actorType as "USER" | "CUSTOMER" | "SYSTEM",
      actorId: fields.actorId,
      actorLabel: fields.actorLabel,
      action: fields.action,
      entityType: fields.entityType,
      entityId: fields.entityId,
      jobId: fields.jobId,
      metadata,
      ip: fields.ip,
      userAgent: fields.userAgent,
      prevHash: fields.prevHash,
      hash: computeAuditHash(fields),
    },
  });
}

/** Convenience for a single standalone event. */
export async function audit(event: AuditEvent): Promise<void> {
  await db.$transaction((tx) => recordAudit(tx, event));
}

export interface ChainVerification {
  ok: boolean;
  checked: number;
  brokenAtSeq?: string;
  reason?: string;
}

/** Recompute every hash in order and confirm each row links to the one before it. */
export async function verifyAuditChain(orgId: string): Promise<ChainVerification> {
  let checked = 0;
  let prev: string | null = null;
  let cursor: bigint | null = null;
  for (;;) {
    const rows: Awaited<ReturnType<typeof db.auditLog.findMany>> = await db.auditLog.findMany({
      where: { orgId, ...(cursor !== null ? { seq: { gt: cursor } } : {}) },
      orderBy: { seq: "asc" },
      take: 500,
    });
    if (rows.length === 0) break;
    for (const row of rows) {
      if (row.prevHash !== prev) {
        return { ok: false, checked, brokenAtSeq: row.seq.toString(), reason: "Chain link does not match the previous entry" };
      }
      const expected = computeAuditHash({
        prevHash: row.prevHash,
        orgId: row.orgId,
        at: row.at.toISOString(),
        actorType: row.actorType,
        actorId: row.actorId,
        actorLabel: row.actorLabel,
        action: row.action,
        entityType: row.entityType,
        entityId: row.entityId,
        jobId: row.jobId,
        metadata: row.metadata,
        ip: row.ip,
        userAgent: row.userAgent,
      });
      if (expected !== row.hash) {
        return { ok: false, checked, brokenAtSeq: row.seq.toString(), reason: "Entry content does not match its hash" };
      }
      prev = row.hash;
      checked += 1;
      cursor = row.seq;
    }
  }
  return { ok: true, checked };
}
