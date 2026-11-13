import Link from "next/link";
import { notFound } from "next/navigation";
import { currentActor } from "@/lib/session";
import { formatDateTimeUS } from "@/lib/dates";
import { centsToInput } from "@/lib/money";
import { DOC_LABELS, PAYMENT_METHOD_LABELS, VERSION_STATUS_LABELS, VERSION_STATUS_TONE, docTypeFromSlug } from "@/domain/labels";
import { PAYMENT_METHODS, type DocType } from "@/domain/types";
import type { DocumentPayload } from "@/domain/payloads";
import { getActiveLink } from "@/services/documents";
import { getDocumentView } from "@/services/queries";
import { DocumentView } from "@/components/document-view";
import { Badge, Card, DL, Field, Flash, LinkButton, PageTitle, flashOf, inputClass, type SP } from "@/components/ui";
import { SubmitButton } from "@/components/submit-button";
import { discardAction, resendAction, reviseAction, saveDraftAction, sendAction, startDocumentAction } from "../../actions";

export const metadata = { title: "Document" };

function Editor({ payload, services }: { payload: DocumentPayload; services: { code: string; label: string }[] }) {
  const p = payload;
  const hasCurrent = services.some((s) => s.code === p.serviceCode);
  return (
    <div className="space-y-4">
      <div className="grid gap-3 sm:grid-cols-2">
        <Field label="Hail repair service">
          <select name="serviceCode" defaultValue={p.serviceCode} required className={inputClass}>
            {!p.serviceCode && <option value="">Choose a service...</option>}
            {!hasCurrent && p.serviceCode && <option value={p.serviceCode}>{p.serviceLabel}</option>}
            {services.map((s) => <option key={s.code} value={s.code}>{s.label}</option>)}
          </select>
        </Field>
        <Field label="Observation" hint='For example "Pull paint rail right" or "left side".'>
          <input name="observation" defaultValue={p.observation} maxLength={300} className={inputClass} />
        </Field>
      </div>
      {p.type === "AUTHORIZATION" && (
        <div className="grid gap-3 sm:grid-cols-2">
          <Field label="Estimated amount (USD)"><input name="estimatedAmount" inputMode="decimal" defaultValue={centsToInput(p.estimatedAmountCents)} className={inputClass} /></Field>
          <Field label="PO / approval #"><input name="poNumber" defaultValue={p.poNumber ?? ""} className={inputClass} /></Field>
          <Field label="Start date"><input name="startDate" type="date" defaultValue={p.startDate} required className={inputClass} /></Field>
          <Field label="Target completion"><input name="targetDate" type="date" defaultValue={p.targetDate ?? ""} className={inputClass} /></Field>
          <Field label="Payment method">
            <select name="paymentMethod" defaultValue={p.paymentMethod ?? ""} className={inputClass}>
              <option value="">Not specified</option>
              {PAYMENT_METHODS.map((m) => <option key={m} value={m}>{PAYMENT_METHOD_LABELS[m]}</option>)}
            </select>
          </Field>
        </div>
      )}
      {p.type === "COMPLETION" && (
        <div className="grid gap-3 sm:grid-cols-2">
          <Field label="Completion date"><input name="completionDate" type="date" defaultValue={p.completionDate} required className={inputClass} /></Field>
          <Field label="Notes"><input name="notes" defaultValue={p.notes ?? ""} className={inputClass} /></Field>
        </div>
      )}
      {p.type === "INVOICE" && (
        <div className="grid gap-3 sm:grid-cols-2">
          <Field label="Amount (USD)"><input name="amount" inputMode="decimal" defaultValue={centsToInput(p.amountCents)} className={inputClass} /></Field>
          <Field label="Notes"><input name="notes" defaultValue={p.notes ?? ""} className={inputClass} /></Field>
          <Field label="Invoice date"><input name="invoiceDate" type="date" defaultValue={p.invoiceDate} required className={inputClass} /></Field>
          <Field label="Due date"><input name="dueDate" type="date" defaultValue={p.dueDate} required className={inputClass} /></Field>
          <label className="flex items-center gap-2 text-sm text-gray-800 sm:col-span-2">
            <input type="checkbox" name="requiresAcknowledgment" defaultChecked={p.requiresAcknowledgment} className="size-5" />
            Ask the customer to sign to acknowledge this invoice (otherwise they can only view it)
          </label>
        </div>
      )}
    </div>
  );
}

export default async function DocumentPage({ params, searchParams }: { params: Promise<{ id: string; doc: string }>; searchParams: SP }) {
  const { id, doc } = await params;
  const type = docTypeFromSlug(doc);
  if (!type) notFound();
  const { error, notice, v } = await flashOf(searchParams);
  const actor = await currentActor();
  const view = await getDocumentView(actor, id, type, v ? Number(v) || undefined : undefined);
  const { job } = view;
  const tz = job.org.timezone;
  const back = `/jobs/${job.id}`;

  if (!view.document || !view.version || !view.payload) {
    return (
      <>
        <PageTitle sub={<Link href={back} className="underline">{job.number}</Link>}>{DOC_LABELS[type]}</PageTitle>
        <Flash error={error} notice={notice} />
        <Card>
          <p className="mb-3 text-sm text-gray-700">This document has not been started yet.</p>
          <form action={startDocumentAction.bind(null, job.id, type as DocType)}><SubmitButton pendingText="Creating...">Create draft</SubmitButton></form>
        </Card>
      </>
    );
  }

  const { document, version, payload, services, requests } = view;
  const isLatest = document.versions[0].id === version.id;
  const link = version.status === "SENT" ? await getActiveLink(actor, version.id) : null;
  const defaultEmail = job.contact?.email ?? job.customer.email ?? "";
  const defaultName = job.contact?.name ?? "";
  const pdfHref = `/api/documents/${version.id}/pdf`;

  return (
    <>
      <PageTitle
        sub={<><Link href={back} className="underline">{job.number}</Link> · {job.customer.name} · {document.number} · version {version.version}</>}
        action={<Badge tone={VERSION_STATUS_TONE[version.status]}>{VERSION_STATUS_LABELS[version.status]}</Badge>}
      >
        {DOC_LABELS[type]}
      </PageTitle>
      <Flash error={error} notice={notice} />
      {!isLatest && <Flash notice={`You are viewing version ${version.version}. The latest is version ${document.versions[0].version}.`} />}

      <div className="space-y-4">
        {version.status === "DRAFT" && isLatest ? (
          <form className="space-y-4">
            <Card title="Details"><Editor payload={payload} services={services} /></Card>
            <Card title="Send to customer">
              <div className="grid gap-3 sm:grid-cols-2">
                <Field label="Recipient email"><input name="toEmail" type="email" defaultValue={defaultEmail} className={inputClass} /></Field>
                <Field label="Recipient name"><input name="toName" defaultValue={defaultName} className={inputClass} /></Field>
              </div>
              <div className="mt-4 flex flex-wrap gap-2">
                <SubmitButton variant="secondary" pendingText="Saving..." formAction={saveDraftAction.bind(null, job.id, type, version.id)}>Save draft</SubmitButton>
                <SubmitButton pendingText="Sending..." formAction={sendAction.bind(null, job.id, type, version.id)}>Save and send for signature</SubmitButton>
                <SubmitButton variant="danger" confirm="Discard this draft?" formAction={discardAction.bind(null, job.id, type, version.id)}>Discard</SubmitButton>
                <a href={pdfHref} target="_blank" className="inline-flex min-h-11 items-center px-2 text-sm underline">Preview PDF</a>
              </div>
            </Card>
          </form>
        ) : (
          <Card title="Document"><DocumentView payload={payload} number={document.number} version={version.version} /></Card>
        )}

        {version.status === "SENT" && isLatest && (
          <Card title="Waiting for the customer">
            {requests[0] && (
              <p className="mb-3 text-sm text-gray-700">
                Sent to {requests[0].sentToEmail}. {requests[0].viewCount > 0 ? `Opened ${requests[0].viewCount}x, first on ${formatDateTimeUS(requests[0].firstViewedAt, tz)}.` : "Not opened yet."}
              </p>
            )}
            {link ? (
              <div className="mb-4">
                <div className="mb-1 text-xs font-medium uppercase tracking-wide text-gray-500">Signing link (expires {formatDateTimeUS(link.expiresAt, tz)})</div>
                <input readOnly value={link.link} className={`${inputClass} font-mono text-xs`} />
              </div>
            ) : (
              <p className="mb-4 text-sm text-amber-700">The link has expired or was replaced. Send a new one.</p>
            )}
            <form className="grid gap-3 sm:grid-cols-3">
              <Field label="Email"><input name="toEmail" type="email" defaultValue={requests[0]?.sentToEmail ?? defaultEmail} className={inputClass} /></Field>
              <Field label="Name"><input name="toName" defaultValue={requests[0]?.sentToName ?? defaultName} className={inputClass} /></Field>
              <div className="flex items-end gap-2">
                <SubmitButton variant="secondary" pendingText="Sending..." formAction={resendAction.bind(null, job.id, type, version.id)}>Send new link</SubmitButton>
              </div>
            </form>
            <form action={reviseAction.bind(null, job.id, type, version.id)} className="mt-3">
              <SubmitButton variant="secondary" confirm="Edit this document? The link already sent will stop working." pendingText="Working...">Edit (voids the sent link)</SubmitButton>
            </form>
          </Card>
        )}

        {version.signature && (
          <Card title="Signature">
            <DL
              rows={[
                ["Signed by", `${version.signature.signerName}${version.signature.signerTitle ? `, ${version.signature.signerTitle}` : ""}`],
                ["Signed on", formatDateTimeUS(version.signature.signedAt, tz)],
                ["IP address", version.signature.ip ?? "-"],
                ["Authority confirmed", version.signature.authorityConfirmed ? "Yes" : "No"],
                ["Exceptions noted", version.signature.exceptions ?? "None"],
                ["Content fingerprint (SHA-256)", <code key="h" className="break-all text-xs">{version.signature.contentHash}</code>],
              ]}
            />
          </Card>
        )}

        <div className="flex flex-wrap gap-2">
          {version.status !== "DRAFT" && <LinkButton href={pdfHref}>Download PDF</LinkButton>}
          {version.status === "SIGNED" && isLatest && (
            <form action={reviseAction.bind(null, job.id, type, version.id)}>
              <SubmitButton variant="secondary" confirm="Create a new version? The signed version stays on file and the new one needs a new signature." pendingText="Working...">Create new version</SubmitButton>
            </form>
          )}
        </div>

        <Card title="Versions">
          <ul className="divide-y divide-gray-100 text-sm">
            {document.versions.map((ver) => (
              <li key={ver.id} className="flex items-center justify-between py-2">
                <Link className={`underline ${ver.id === version.id ? "font-semibold" : ""}`} href={`/jobs/${job.id}/${doc}?v=${ver.version}`}>Version {ver.version}</Link>
                <span className="flex items-center gap-2 text-gray-600">
                  {ver.signature ? formatDateTimeUS(ver.signature.signedAt, tz) : formatDateTimeUS(ver.createdAt, tz)}
                  <Badge tone={VERSION_STATUS_TONE[ver.status]}>{VERSION_STATUS_LABELS[ver.status]}</Badge>
                </span>
              </li>
            ))}
          </ul>
        </Card>
      </div>
    </>
  );
}
