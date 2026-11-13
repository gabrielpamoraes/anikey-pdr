import Link from "next/link";
import { currentActor } from "@/lib/session";
import { listCustomers } from "@/services/queries";
import { Card, Flash, LinkButton, PageTitle, btnClass, flashOf, inputClass, type SP } from "@/components/ui";

export const metadata = { title: "Customers" };

export default async function CustomersPage({ searchParams }: { searchParams: SP }) {
  const { error, notice, q } = await flashOf(searchParams);
  const customers = await listCustomers(await currentActor(), q);
  return (
    <>
      <PageTitle action={<LinkButton href="/customers/new" variant="primary">New customer</LinkButton>}>Customers</PageTitle>
      <Flash error={error} notice={notice} />
      <form action="/customers" className="mb-4 flex gap-2">
        <input name="q" defaultValue={q} placeholder="Search name, email or contact" className={inputClass} />
        <button className={btnClass("secondary")}>Search</button>
      </form>
      {customers.length === 0 ? (
        <Card><p className="text-sm text-gray-600">No customers yet.</p></Card>
      ) : (
        <ul className="space-y-2">
          {customers.map((c) => (
            <li key={c.id}>
              <Link href={`/customers/${c.id}`} className="flex items-center justify-between rounded-xl border border-gray-200 bg-white p-4 shadow-sm hover:border-gray-300">
                <div>
                  <div className="font-semibold">{c.name}</div>
                  <div className="text-sm text-gray-600">{[c.email, c.phone].filter(Boolean).join(" · ") || "No contact details"}</div>
                </div>
                <span className="text-sm text-gray-500">{c._count.jobs} job{c._count.jobs === 1 ? "" : "s"}</span>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </>
  );
}
