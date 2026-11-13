import { currentActor, requireAdmin } from "@/lib/session";
import { formatDateTimeUS } from "@/lib/dates";
import { verifyAuditChain } from "@/services/audit";
import { getOrg, listAudit } from "@/services/queries";
import { Badge, Card, PageTitle } from "@/components/ui";

export const metadata = { title: "Audit trail" };
export const dynamic = "force-dynamic";

export default async function AuditPage() {
  await requireAdmin();
  const actor = await currentActor();
  const [org, rows, chain] = await Promise.all([getOrg(actor.orgId), listAudit(actor, 200), verifyAuditChain(actor.orgId)]);
  return (
    <>
      <PageTitle sub="Append-only log. Each entry is chained to the previous one, so edits or deletions are detectable.">Audit trail</PageTitle>
      <Card className="mb-4">
        {chain.ok ? <Badge tone="green">Chain intact ({chain.checked} entries verified)</Badge> : <Badge tone="red">Chain broken at entry {chain.brokenAtSeq}: {chain.reason}</Badge>}
      </Card>
      <Card>
        <div className="overflow-x-auto">
          <table className="w-full text-left text-sm">
            <thead className="text-xs uppercase text-gray-500"><tr><th className="py-2 pr-3">When</th><th className="pr-3">Who</th><th className="pr-3">Action</th><th>IP</th></tr></thead>
            <tbody className="divide-y divide-gray-100">
              {rows.map((r) => (
                <tr key={r.id}><td className="whitespace-nowrap py-2 pr-3 text-gray-600">{formatDateTimeUS(r.at, org.timezone)}</td><td className="pr-3">{r.actorLabel}</td><td className="pr-3 font-mono text-xs">{r.action}</td><td className="text-gray-500">{r.ip ?? "-"}</td></tr>
              ))}
            </tbody>
          </table>
        </div>
      </Card>
    </>
  );
}
