import { currentActor } from "@/lib/session";
import { listCustomers, getCustomer } from "@/services/queries";
import { Card, Field, Flash, PageTitle, flashOf, inputClass, LinkButton, type SP } from "@/components/ui";
import { SubmitButton } from "@/components/submit-button";
import { createJobAction } from "../actions";

export const metadata = { title: "New job" };

export default async function NewJobPage({ searchParams }: { searchParams: SP }) {
  const { error, customer: customerId } = await flashOf(searchParams);
  const actor = await currentActor();
  const customers = await listCustomers(actor);
  const selected = customerId ? await getCustomer(actor, customerId).catch(() => null) : null;

  return (
    <>
      <PageTitle>New job</PageTitle>
      <Flash error={error} />
      <form action={createJobAction} className="space-y-4">
        <Card title="Customer">
          <div className="grid gap-3 sm:grid-cols-2">
            <Field label="Existing customer">
              <select name="customerId" defaultValue={selected?.id ?? ""} className={inputClass}>
                <option value="">New customer...</option>
                {customers.map((c) => (
                  <option key={c.id} value={c.id}>{c.name}</option>
                ))}
              </select>
            </Field>
            <Field label="Or new customer name" hint="Used only when no existing customer is selected.">
              <input name="newCustomerName" className={inputClass} />
            </Field>
          </div>
          {selected && selected.contacts.length > 0 && (
            <div className="mt-3">
              <Field label="Contact">
                <select name="contactId" className={inputClass}>
                  <option value="">New contact (fill below)</option>
                  {selected.contacts.map((c) => (
                    <option key={c.id} value={c.id}>{c.name}{c.title ? `, ${c.title}` : ""}</option>
                  ))}
                </select>
              </Field>
            </div>
          )}
          {!selected && <p className="mt-2 text-xs text-gray-500">To reuse a saved contact, start the job from the customer&rsquo;s page under Customers.</p>}
          <div className="mt-3 grid gap-3 sm:grid-cols-2">
            <Field label="Contact name"><input name="contactName" className={inputClass} /></Field>
            <Field label="Contact title"><input name="contactTitle" className={inputClass} /></Field>
            <Field label="Contact email" hint="Where signing links are sent."><input name="contactEmail" type="email" className={inputClass} /></Field>
            <Field label="Contact phone"><input name="contactPhone" type="tel" className={inputClass} /></Field>
          </div>
        </Card>
        <Card title="Vehicle">
          <div className="grid gap-3 sm:grid-cols-2">
            <Field label="Year"><input name="year" inputMode="numeric" maxLength={4} className={inputClass} /></Field>
            <Field label="Make"><input name="make" required className={inputClass} /></Field>
            <Field label="Model"><input name="model" required className={inputClass} /></Field>
            <Field label="Color"><input name="color" className={inputClass} /></Field>
            <Field label="VIN"><input name="vin" maxLength={17} className={`${inputClass} uppercase`} /></Field>
            <Field label="License plate"><input name="licensePlate" className={`${inputClass} uppercase`} /></Field>
            <Field label="Stock # / RO #"><input name="referenceNumber" className={inputClass} /></Field>
          </div>
        </Card>
        <div className="flex gap-2">
          <SubmitButton pendingText="Creating...">Create job</SubmitButton>
          <LinkButton href="/jobs">Cancel</LinkButton>
        </div>
      </form>
    </>
  );
}
