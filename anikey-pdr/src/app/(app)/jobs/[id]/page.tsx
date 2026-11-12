import Link from "next/link";
import { currentActor } from "@/lib/session";
import { dateColumnToISO, formatDateTimeUS, formatDateUS, todayISO } from "@/lib/dates";
import { formatUsd } from "@/lib/money";
import { DOC_LABELS, DOC_STEP, JOB_STATUS_LABELS, JOB_STATUS_TONE, PAYMENT_METHOD_LABELS, VERSION_STATUS_LABELS, VERSION_STATUS_TONE, docSlug } from "@/domain/labels";
import { DOCUMENT_TYPES, PAYMENT_METHODS, type DocType } from "@/domain/types";
import { canStartDocument } from "@/domain/job-status";
import { getJobDetail } from "@/services/queries";
import { Badge, Card, DL, Field, Flash, LinkButton, PageTitle, flashOf, inputClass, type SP } from "@/components/ui";
import { SubmitButton } from "@/components/submit-button";
import { cancelJobAction, deletePhotoAction, paymentAction, startDocumentAction, uploadPhotoAction } from "../actions";

export const metadata = { title: "Job" };

export default async function JobPage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: SP }) {
  const { id } = await params;
  const { error, notice } = await flashOf(searchParams);
  const actor = await currentActor();
  const { job, history, byType, lite, current } = await getJobDetail(actor, id);
  const tz = job.org.timezone;
  const due = dateColumnToISO(job.dueDate);
  const overdue = job.status === "INVOICED" && due !== null && due < todayISO(tz);
  const balance = (job.amountCents ?? 0) - job.paidCents;
  const car = [job.vehicle.year, job.vehicle.make, job.vehicle.model].filter(Boolean).join(" ");

  return (
    <>
      <PageTitle
        sub={<>{job.customer.name} · {car}</>}
        action={overdue ? <Badge tone="red">Overdue</Badge> : <Badge tone={JOB_STATUS_TONE[job.status]}>{JOB_STATUS_LABELS[job.status]}</Badge>}
      >
        {job.number}
      </PageTitle>
      <Flash error={error} notice={notice} />

      <div className="space-y-4">
        <Card title="Job">
          <DL
            rows={[
              ["Customer", <Link key="c" className="underline" href={`/customers/${job.customerId}`}>{job.customer.name}</Link>],
              ["Contact", job.contact ? `${job.contact.name}${job.contact.email ? ` · ${job.contact.email}` : ""}` : "-"],
              ["Vehicle", car],
              ["VIN", job.vehicle.vin ?? "-"],
              ["Plate / color", [job.vehicle.licensePlate, job.vehicle.color].filter(Boolean).join(" · ") || "-"],
              ["Stock # / RO #", job.referenceNumber ?? "-"],
              ["Service", job.serviceLabel ?? "-"],
              ["Invoice", job.amountCents !== null ? `${formatUsd(job.amountCents)} · paid ${formatUsd(job.paidCents)}${due ? ` · due ${formatDateUS(due)}` : ""}` : "-"],
            ]}
          />
        </Card>

        <Card title="Documents">
          <ol className="space-y-3">
            {DOCUMENT_TYPES.map((type: DocType) => {
              const doc = byType(type);
              const cur = current(type);
              const latest = doc?.versions[0];
              const allowed = canStartDocument(type, lite, job.org.enforceDocumentOrder);
              return (
                <li key={type} className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-gray-200 p-3">
                  <div>
                    <div className="text-xs font-semibold uppercase tracking-wide text-gray-500">Step {DOC_STEP[type]}</div>
                    <div className="font-medium text-gray-900">{DOC_LABELS[type]}</div>
                    {doc && latest ? (
                      <div className="mt-1 flex flex-wrap items-center gap-2 text-sm text-gray-600">
                        <span>{doc.number} · v{latest.version}</span>
                        <Badge tone={VERSION_STATUS_TONE[latest.status]}>{VERSION_STATUS_LABELS[latest.status]}</Badge>
                        {cur?.status === "SIGNED" && latest.signature && <span>signed by {latest.signature.signerName} on {formatDateTimeUS(latest.signature.signedAt, tz)}</span>}
                      </div>
                    ) : (
                      !allowed.ok && <div className="mt-1 text-sm text-gray-500">{allowed.reason}</div>
                    )}
                  </div>
                  {doc ? (
                    <LinkButton href={`/jobs/${job.id}/${docSlug(type)}`}>Open</LinkButton>
                  ) : job.status === "CANCELLED" ? null : (
                    <form action={startDocumentAction.bind(null, job.id, type)}>
                      <SubmitButton variant={allowed.ok ? "primary" : "secondary"} pendingText="Creating..." >Create</SubmitButton>
                    </form>
                  )}
                </li>
              );
            })}
          </ol>
        </Card>

        {(job.status === "INVOICED" || job.status === "PAID" || job.payments.length > 0) && (
          <Card title="Payments">
            {job.payments.length > 0 && (
              <ul className="mb-3 divide-y divide-gray-100 text-sm">
                {job.payments.map((p) => (
                  <li key={p.id} className="flex justify-between py-2">
                    <span>{formatDateUS(dateColumnToISO(p.paidAt))} · {PAYMENT_METHOD_LABELS[p.method]}{p.reference ? ` · ${p.reference}` : ""}</span>
                    <span className="font-medium">{formatUsd(p.amountCents)}</span>
                  </li>
                ))}
              </ul>
            )}
            {job.status === "INVOICED" ? (
              <form action={paymentAction.bind(null, job.id)} className="grid gap-3 sm:grid-cols-5">
                <Field label={`Amount (balance ${formatUsd(balance)})`}><input name="amountDollars" inputMode="decimal" required className={inputClass} /></Field>
                <Field label="Method">
                  <select name="method" className={inputClass}>
                    {PAYMENT_METHODS.map((m) => <option key={m} value={m}>{PAYMENT_METHOD_LABELS[m]}</option>)}
                  </select>
                </Field>
                <Field label="Date"><input name="paidAt" type="date" defaultValue={todayISO(tz)} required className={inputClass} /></Field>
                <Field label="Reference"><input name="reference" placeholder="Check #" className={inputClass} /></Field>
                <div className="flex items-end"><SubmitButton pendingText="Saving...">Record payment</SubmitButton></div>
              </form>
            ) : (
              <p className="text-sm text-gray-600">Balance {formatUsd(balance)}.</p>
            )}
          </Card>
        )}

        <Card title="Photos">
          {job.photos.length > 0 && (
            <ul className="mb-4 grid grid-cols-2 gap-3 sm:grid-cols-4">
              {job.photos.map((ph) => (
                <li key={ph.id} className="text-xs text-gray-600">
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <a href={`/api/photos/${ph.id}`} target="_blank"><img src={`/api/photos/${ph.id}`} alt={ph.caption ?? ph.kind} loading="lazy" className="aspect-square w-full rounded-lg object-cover" /></a>
                  <div className="mt-1 flex items-center justify-between gap-1">
                    <span>{ph.kind[0] + ph.kind.slice(1).toLowerCase()}{ph.caption ? ` · ${ph.caption}` : ""}</span>
                    <form action={deletePhotoAction.bind(null, job.id, ph.id)}><SubmitButton variant="danger" confirm="Remove this photo?" className="!min-h-7 !px-2 !py-0.5 text-xs">Remove</SubmitButton></form>
                  </div>
                </li>
              ))}
            </ul>
          )}
          <form action={uploadPhotoAction.bind(null, job.id)} className="grid gap-3 sm:grid-cols-4">
            <Field label="Photo"><input name="photo" type="file" accept="image/jpeg,image/png,image/webp" capture="environment" multiple className={inputClass} /></Field>
            <Field label="Type">
              <select name="kind" className={inputClass}>
                <option value="BEFORE">Before</option>
                <option value="AFTER">After</option>
                <option value="OTHER">Other</option>
              </select>
            </Field>
            <Field label="Caption"><input name="caption" className={inputClass} /></Field>
            <div className="flex items-end"><SubmitButton variant="secondary" pendingText="Uploading...">Add photo</SubmitButton></div>
          </form>
        </Card>

        <Card title="History">
          <ul className="space-y-1 text-sm text-gray-700">
            {history.map((h) => (
              <li key={h.id}><span className="text-gray-500">{formatDateTimeUS(h.at, tz)}</span> · {h.actorLabel} · {h.action}</li>
            ))}
          </ul>
        </Card>

        {actor.role === "ADMIN" && job.status !== "CANCELLED" && job.status !== "PAID" && (
          <Card title="Cancel job">
            <form action={cancelJobAction.bind(null, job.id)} className="flex flex-wrap items-end gap-3">
              <div className="min-w-60 flex-1"><Field label="Reason (optional)"><input name="reason" className={inputClass} /></Field></div>
              <SubmitButton variant="danger" confirm="Cancel this job? Open signing links will stop working.">Cancel job</SubmitButton>
            </form>
          </Card>
        )}
      </div>
    </>
  );
}
