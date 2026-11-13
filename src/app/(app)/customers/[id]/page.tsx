import Link from "next/link";
import { currentActor } from "@/lib/session";
import { formatUsd } from "@/lib/money";
import { JOB_STATUS_LABELS, JOB_STATUS_TONE } from "@/domain/labels";
import { getCustomer } from "@/services/queries";
import { Badge, Card, DL, Field, Flash, LinkButton, PageTitle, flashOf, inputClass, type SP } from "@/components/ui";
import { SubmitButton } from "@/components/submit-button";
import { addContactAction } from "../actions";

export const metadata = { title: "Customer" };

export default async function CustomerPage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: SP }) {
  const { id } = await params;
  const { error, notice } = await flashOf(searchParams);
  const c = await getCustomer(await currentActor(), id);
  return (
    <>
      <PageTitle action={<LinkButton href={`/jobs/new?customer=${c.id}`} variant="primary">New job</LinkButton>}>{c.name}</PageTitle>
      <Flash error={error} notice={notice} />
      <div className="space-y-4">
        <Card title="Details">
          <DL rows={[["Email", c.email ?? "-"], ["Phone", c.phone ?? "-"], ["Address", [c.addressLine1, c.city, [c.state, c.zip].filter(Boolean).join(" ")].filter(Boolean).join(", ") || "-"], ["Notes", c.notes ?? "-"]]} />
        </Card>
        <Card title="Contacts">
          <ul className="mb-4 divide-y divide-gray-100 text-sm">
            {c.contacts.length === 0 && <li className="py-2 text-gray-600">No contacts yet.</li>}
            {c.contacts.map((p) => (
              <li key={p.id} className="py-2"><span className="font-medium">{p.name}</span>{p.title ? `, ${p.title}` : ""} <span className="text-gray-600">{[p.email, p.phone].filter(Boolean).join(" · ")}</span></li>
            ))}
          </ul>
          <form action={addContactAction.bind(null, c.id)} className="grid gap-3 sm:grid-cols-4">
            <Field label="Name"><input name="name" required className={inputClass} /></Field>
            <Field label="Title"><input name="title" className={inputClass} /></Field>
            <Field label="Email"><input name="email" type="email" className={inputClass} /></Field>
            <Field label="Phone"><input name="phone" type="tel" className={inputClass} /></Field>
            <div className="sm:col-span-4"><SubmitButton variant="secondary" pendingText="Adding...">Add contact</SubmitButton></div>
          </form>
        </Card>
        <Card title="Recent jobs">
          <ul className="divide-y divide-gray-100 text-sm">
            {c.jobs.length === 0 && <li className="py-2 text-gray-600">No jobs yet.</li>}
            {c.jobs.map((j) => (
              <li key={j.id} className="flex items-center justify-between py-2">
                <Link href={`/jobs/${j.id}`} className="underline">{j.number}</Link>
                <span className="text-gray-600">{[j.vehicle.year, j.vehicle.make, j.vehicle.model].filter(Boolean).join(" ")}{j.amountCents !== null ? ` · ${formatUsd(j.amountCents)}` : ""}</span>
                <Badge tone={JOB_STATUS_TONE[j.status]}>{JOB_STATUS_LABELS[j.status]}</Badge>
              </li>
            ))}
          </ul>
        </Card>
      </div>
    </>
  );
}
