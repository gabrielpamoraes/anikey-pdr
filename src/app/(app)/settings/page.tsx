import { db } from "@/lib/db";
import { requireAdmin } from "@/lib/session";
import { getOrg, listServiceTypes } from "@/services/queries";
import { Badge, Card, Field, Flash, PageTitle, flashOf, inputClass, type SP } from "@/components/ui";
import { SubmitButton } from "@/components/submit-button";
import { addServiceAction, addUserAction, saveSettingsAction, setUserActiveAction, toggleServiceAction } from "./actions";

export const metadata = { title: "Settings" };

export default async function SettingsPage({ searchParams }: { searchParams: SP }) {
  const { error, notice } = await flashOf(searchParams);
  const user = await requireAdmin();
  const [org, services, users] = await Promise.all([
    getOrg(user.orgId),
    listServiceTypes(user.orgId),
    db.user.findMany({ where: { orgId: user.orgId }, orderBy: { name: "asc" } }),
  ]);
  return (
    <>
      <PageTitle>Settings</PageTitle>
      <Flash error={error} notice={notice} />
      <div className="space-y-4">
        <form action={saveSettingsAction} className="space-y-4">
          <Card title="Company">
            <div className="grid gap-3 sm:grid-cols-2">
              <Field label="Name"><input name="name" defaultValue={org.name} required className={inputClass} /></Field>
              <Field label="Email"><input name="email" type="email" defaultValue={org.email} required className={inputClass} /></Field>
              <Field label="Phone"><input name="phone" defaultValue={org.phone ?? ""} className={inputClass} /></Field>
              <Field label="Address"><input name="addressLine" defaultValue={org.addressLine ?? ""} className={inputClass} /></Field>
              <Field label="Time zone" hint="Used for due dates and timestamps, e.g. America/Los_Angeles."><input name="timezone" defaultValue={org.timezone} className={inputClass} /></Field>
              <Field label="Payment terms (days)"><input name="paymentTermsDays" inputMode="numeric" defaultValue={org.paymentTermsDays} className={inputClass} /></Field>
              <Field label="Signing link valid for (days)"><input name="signingLinkDays" inputMode="numeric" defaultValue={org.signingLinkDays} className={inputClass} /></Field>
            </div>
            <label className="mt-4 flex items-center gap-2 text-sm">
              <input type="checkbox" name="enforceDocumentOrder" defaultChecked={org.enforceDocumentOrder} className="size-5" />
              Require the order Authorization, then Completion, then Invoice
            </label>
          </Card>
          <Card title="Document text (copied into each document when it is created)">
            <div className="space-y-3">
              <Field label="Work authorization terms"><textarea name="termsAuthorization" rows={5} defaultValue={org.termsAuthorization} className={inputClass} /></Field>
              <Field label="Completion & acceptance terms"><textarea name="termsAcceptance" rows={5} defaultValue={org.termsAcceptance} className={inputClass} /></Field>
              <Field label="Invoice terms"><textarea name="termsInvoice" rows={5} defaultValue={org.termsInvoice} className={inputClass} /></Field>
              <Field label="Payment instructions (remittance)"><textarea name="remittanceInfo" rows={3} defaultValue={org.remittanceInfo} className={inputClass} /></Field>
            </div>
            <p className="mt-2 text-xs text-gray-500">Changing this text affects new documents only. Documents already created keep the text they were created with.</p>
          </Card>
          <SubmitButton pendingText="Saving...">Save settings</SubmitButton>
        </form>

        <Card title="Hail repair services">
          <ul className="mb-4 divide-y divide-gray-100 text-sm">
            {services.map((s) => (
              <li key={s.id} className="flex items-center justify-between py-2">
                <span>{s.label} {!s.active && <Badge>Hidden</Badge>}</span>
                <form action={toggleServiceAction.bind(null, s.id, !s.active)}><SubmitButton variant="secondary" className="!min-h-8 !py-1 text-xs">{s.active ? "Hide" : "Show"}</SubmitButton></form>
              </li>
            ))}
          </ul>
          <form action={addServiceAction} className="flex items-end gap-3">
            <div className="flex-1"><Field label="New service"><input name="label" required className={inputClass} /></Field></div>
            <SubmitButton variant="secondary" pendingText="Adding...">Add</SubmitButton>
          </form>
        </Card>

        <Card title="Team">
          <ul className="mb-4 divide-y divide-gray-100 text-sm">
            {users.map((u) => (
              <li key={u.id} className="flex items-center justify-between py-2">
                <span>{u.name} <span className="text-gray-500">· {u.email} · {u.role === "ADMIN" ? "Admin" : "Technician"}</span> {!u.active && <Badge tone="red">Disabled</Badge>}</span>
                {u.id !== user.id && <form action={setUserActiveAction.bind(null, u.id, !u.active)}><SubmitButton variant="secondary" className="!min-h-8 !py-1 text-xs">{u.active ? "Disable" : "Enable"}</SubmitButton></form>}
              </li>
            ))}
          </ul>
          <form action={addUserAction} className="grid gap-3 sm:grid-cols-4">
            <Field label="Name"><input name="name" required className={inputClass} /></Field>
            <Field label="Email"><input name="email" type="email" required className={inputClass} /></Field>
            <Field label="Temporary password"><input name="password" type="password" autoComplete="new-password" minLength={10} required className={inputClass} /></Field>
            <Field label="Role"><select name="role" className={inputClass}><option value="TECHNICIAN">Technician</option><option value="ADMIN">Admin</option></select></Field>
            <div className="sm:col-span-4"><SubmitButton variant="secondary" pendingText="Adding...">Add user</SubmitButton></div>
          </form>
        </Card>
      </div>
    </>
  );
}
