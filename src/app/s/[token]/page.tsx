import { headers } from "next/headers";
import { DocumentView } from "@/components/document-view";
import { SignForm } from "@/components/sign-form";
import { Badge, Card, DL } from "@/components/ui";
import { formatDateTimeUS } from "@/lib/dates";
import { DOC_LABELS } from "@/domain/labels";
import { getRequestMeta } from "@/lib/session";
import { loadByToken, type PublicState } from "@/services/signing";

export const dynamic = "force-dynamic";
export const metadata = { title: "Review document", robots: { index: false, follow: false } };

const MESSAGES: Partial<Record<PublicState, { title: string; body: string }>> = {
  invalid: { title: "Link not found", body: "This link is not valid. Please use the link from the most recent email, or contact the sender." },
  expired: { title: "This link has expired", body: "For security, signing links expire. Please ask the sender for a new one." },
  revoked: { title: "This link is no longer active", body: "The sender issued a newer link or changed the document. Please use the latest email, or ask for a new link." },
  cancelled: { title: "This job was cancelled", body: "The sender cancelled this job, so there is nothing to sign." },
  replaced: { title: "This document was updated", body: "A newer version of this document exists. Please ask the sender for the latest link." },
};

export default async function PublicPage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  await headers(); // opt out of caching: every visit is recorded
  const view = await loadByToken(token, { recordView: true, meta: await getRequestMeta() });

  const msg = MESSAGES[view.state];
  if (msg || !view.payload || !view.org || !view.type || !view.number) {
    const m = msg ?? MESSAGES.invalid!;
    return (
      <main className="mx-auto max-w-md px-4 py-16 text-center">
        <h1 className="text-xl font-bold">{m.title}</h1>
        <p className="mt-2 text-sm text-gray-600">{m.body}</p>
      </main>
    );
  }

  const { org, payload, type, number } = view;
  const label = DOC_LABELS[type];
  const pdf = `/s/${token}/pdf`;
  return (
    <main className="mx-auto max-w-2xl space-y-4 px-4 py-6">
      <header>
        <div className="text-xs font-bold tracking-[0.2em] text-gray-500">{org.name.toUpperCase()}</div>
        <h1 className="mt-1 text-2xl font-bold">{label}</h1>
        <p className="text-sm text-gray-600">{[org.phone, org.email].filter(Boolean).join(" · ")}</p>
      </header>

      <Card><DocumentView payload={payload} number={number} version={view.version ?? 1} /></Card>

      {view.photos && view.photos.length > 0 && (
        <Card title="Photos">
          <ul className="grid grid-cols-2 gap-3 sm:grid-cols-3">
            {view.photos.map((p) => (
              <li key={p.id} className="text-xs text-gray-600">
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <a href={`/s/${token}/photos/${p.id}`} target="_blank"><img src={`/s/${token}/photos/${p.id}`} alt={p.caption ?? p.kind} loading="lazy" className="aspect-square w-full rounded-lg object-cover" /></a>
                {p.caption ?? p.kind[0] + p.kind.slice(1).toLowerCase()}
              </li>
            ))}
          </ul>
        </Card>
      )}

      {view.state === "signed" && view.signature && (
        <Card title="Signed">
          <div className="mb-3"><Badge tone="green">Signed</Badge></div>
          <DL rows={[["Signed by", `${view.signature.signerName}${view.signature.signerTitle ? `, ${view.signature.signerTitle}` : ""}`], ["Signed on", formatDateTimeUS(view.signature.signedAt, org.timezone)], ["Exceptions noted", view.signature.exceptions ?? "None"]]} />
          <a href={pdf} className="mt-4 inline-block text-sm font-semibold text-blue-700 underline">Download your signed copy (PDF)</a>
        </Card>
      )}

      {view.state === "view" && (
        <Card><p className="mb-3 text-sm text-gray-700">This invoice is for your records. No signature is needed.</p><a href={pdf} className="text-sm font-semibold text-blue-700 underline">Download PDF</a></Card>
      )}

      {view.state === "ready" && (
        <Card title={type === "AUTHORIZATION" ? "Authorize the work" : type === "COMPLETION" ? "Accept the completed work" : "Acknowledge the invoice"}>
          <p className="mb-4 text-sm text-gray-700">Review the details above, then sign. You will be able to download a signed copy.</p>
          <SignForm token={token} defaultName={view.signerHint?.name ?? ""} showExceptions={type === "COMPLETION"} label={type === "AUTHORIZATION" ? "Sign and authorize" : type === "COMPLETION" ? "Sign and accept" : "Sign and acknowledge"} />
          <a href={pdf} className="mt-4 inline-block text-sm text-gray-600 underline">Download PDF to review first</a>
        </Card>
      )}
    </main>
  );
}
