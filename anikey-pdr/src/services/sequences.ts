import type { Tx } from "@/lib/db";

/** Atomic per-organization counter (row-locked by the upsert), e.g. key "INV:2026". */
export async function nextSequence(tx: Tx, orgId: string, key: string): Promise<number> {
  const row = await tx.counter.upsert({
    where: { orgId_key: { orgId, key } },
    create: { orgId, key, value: 1 },
    update: { value: { increment: 1 } },
    select: { value: true },
  });
  return row.value;
}
