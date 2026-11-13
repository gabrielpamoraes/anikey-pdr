import { Card, Field, Flash, LinkButton, PageTitle, flashOf, inputClass, type SP } from "@/components/ui";
import { SubmitButton } from "@/components/submit-button";
import { createCustomerAction } from "../actions";

export const metadata = { title: "New customer" };

export default async function NewCustomerPage({ searchParams }: { searchParams: SP }) {
  const { error } = await flashOf(searchParams);
  return (
    <>
      <PageTitle>New customer</PageTitle>
      <Flash error={error} />
      <form action={createCustomerAction} className="space-y-4">
        <Card>
          <div className="grid gap-3 sm:grid-cols-2">
            <Field label="Name"><input name="name" required className={inputClass} /></Field>
            <Field label="Email"><input name="email" type="email" className={inputClass} /></Field>
            <Field label="Phone"><input name="phone" type="tel" className={inputClass} /></Field>
            <Field label="Address"><input name="addressLine1" className={inputClass} /></Field>
            <Field label="City"><input name="city" className={inputClass} /></Field>
            <div className="grid grid-cols-2 gap-3">
              <Field label="State"><input name="state" maxLength={2} className={`${inputClass} uppercase`} /></Field>
              <Field label="ZIP"><input name="zip" inputMode="numeric" className={inputClass} /></Field>
            </div>
          </div>
          <div className="mt-3"><Field label="Notes"><textarea name="notes" rows={3} className={inputClass} /></Field></div>
        </Card>
        <div className="flex gap-2"><SubmitButton pendingText="Saving...">Save customer</SubmitButton><LinkButton href="/customers">Cancel</LinkButton></div>
      </form>
    </>
  );
}
