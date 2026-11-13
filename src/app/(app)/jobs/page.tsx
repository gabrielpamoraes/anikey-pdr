import Link from "next/link";
import { currentActor } from "@/lib/session";
import { dateColumnToISO, formatDateUS } from "@/lib/dates";
import { formatUsd } from "@/lib/money";
import { JOB_STATUS_LABELS, JOB_STATUS_TONE } from "@/domain/labels";
import { JOB_STATUSES } from "@/domain/types";
import { dashboardStats, listJobs, type JobFilter } from "@/services/queries";
import { Badge, Card, Flash, LinkButton, PageTitle, flashOf, inputClass, btnClass, type SP } from "@/components/ui";

export const metadata = { title: "Jobs" };

export default async function JobsPage({ searchParams }: { searchParams: SP }) {
  const { error, notice, q, filter } = await flashOf(searchParams);
  const actor = await currentActor();
  const active = (filter && (filter === "OVERDUE" || (JOB_STATUSES as readonly string[]).includes(filter)) ? filter : "ALL") as JobFilter;
  const [stats, { jobs, today }] = await Promise.all([dashboardStats(actor), listJobs(actor, { q, filter: active })]);

  const tiles: { label: string; value: number; href: string; tone: string }[] = [
    { label: "Awaiting signature", value: stats.awaitingSignature, href: "/jobs?filter=AWAITING_AUTHORIZATION", tone: "text-amber-700" },
    { label: "In progress", value: stats.inProgress, href: "/jobs?filter=IN_PROGRESS", tone: "text-blue-700" },
    { label: "Ready to invoice", value: stats.readyToInvoice, href: "/jobs?filter=READY_TO_INVOICE", tone: "text-blue-700" },
    { label: "Due in 3 days", value: stats.dueSoon, href: "/jobs?filter=INVOICED", tone: "text-violet-700" },
    { label: "Overdue", value: stats.overdue, href: "/jobs?filter=OVERDUE", tone: "text-red-700" },
  ];
  const chips: [string, string][] = [["ALL", "All"], ...JOB_STATUSES.map((s): [string, string] => [s, JOB_STATUS_LABELS[s]]), ["OVERDUE", "Overdue"]];

  return (
    <>
      <PageTitle action={<LinkButton href="/jobs/new" variant="primary">New job</LinkButton>}>Jobs</PageTitle>
      <Flash error={error} notice={notice} />
      <div className="mb-4 grid grid-cols-2 gap-3 sm:grid-cols-5">
        {tiles.map((t) => (
          <Link key={t.label} href={t.href} className="rounded-xl border border-gray-200 bg-white p-3 shadow-sm hover:border-gray-300">
            <div className={`text-2xl font-bold ${t.tone}`}>{t.value}</div>
            <div className="text-xs text-gray-600">{t.label}</div>
          </Link>
        ))}
      </div>
      <form className="mb-3 flex gap-2" action="/jobs">
        <input name="q" defaultValue={q} placeholder="Search customer, VIN, plate, stock #, document #" className={inputClass} />
        {active !== "ALL" && <input type="hidden" name="filter" value={active} />}
        <button className={btnClass("secondary")}>Search</button>
      </form>
      <div className="mb-4 flex gap-2 overflow-x-auto pb-1">
        {chips.map(([value, label]) => (
          <Link key={value} href={`/jobs?filter=${value}${q ? `&q=${encodeURIComponent(q)}` : ""}`} className={`whitespace-nowrap rounded-full border px-3 py-1 text-sm ${active === value ? "border-blue-700 bg-blue-700 text-white" : "border-gray-300 bg-white text-gray-700"}`}>
            {label}
          </Link>
        ))}
      </div>
      {jobs.length === 0 ? (
        <Card><p className="text-sm text-gray-600">No jobs match. Create one with &ldquo;New job&rdquo;.</p></Card>
      ) : (
        <ul className="space-y-2">
          {jobs.map((j) => {
            const due = dateColumnToISO(j.dueDate);
            const overdue = j.status === "INVOICED" && due !== null && due < today;
            const car = [j.vehicle.year, j.vehicle.make, j.vehicle.model].filter(Boolean).join(" ");
            return (
              <li key={j.id}>
                <Link href={`/jobs/${j.id}`} className="block rounded-xl border border-gray-200 bg-white p-4 shadow-sm hover:border-gray-300">
                  <div className="flex items-start justify-between gap-2">
                    <div>
                      <div className="font-semibold text-gray-900">{j.customer.name}</div>
                      <div className="text-sm text-gray-600">{car}{j.referenceNumber ? ` · Stock #${j.referenceNumber}` : ""}</div>
                    </div>
                    <div className="flex flex-col items-end gap-1">
                      {overdue ? <Badge tone="red">Overdue</Badge> : <Badge tone={JOB_STATUS_TONE[j.status]}>{JOB_STATUS_LABELS[j.status]}</Badge>}
                      <span className="text-xs text-gray-500">{j.number}</span>
                    </div>
                  </div>
                  <div className="mt-2 flex flex-wrap gap-x-4 text-sm text-gray-700">
                    {j.serviceLabel && <span>{j.serviceLabel}</span>}
                    {j.amountCents !== null && <span className="font-medium">{formatUsd(j.amountCents)}{j.paidCents > 0 ? ` (paid ${formatUsd(j.paidCents)})` : ""}</span>}
                    {due && j.status === "INVOICED" && <span className={overdue ? "font-medium text-red-700" : ""}>Due {formatDateUS(due)}</span>}
                  </div>
                </Link>
              </li>
            );
          })}
        </ul>
      )}
    </>
  );
}
