"use server";
import { AppError } from "@/lib/errors";
import { formObject, guard, str } from "@/lib/flash";
import { currentActor } from "@/lib/session";
import { createCustomer } from "@/services/customers";
import { addPhoto, cancelJob, createJob, deletePhoto, recordPayment } from "@/services/jobs";
import { createDocumentDraft, discardDraft, resendLink, reviseVersion, saveDraft, sendForSignature } from "@/services/documents";
import { docSlug } from "@/domain/labels";
import type { DocType } from "@/domain/types";

export async function createJobAction(form: FormData) {
  await guard("/jobs/new", async () => {
    const actor = await currentActor();
    let customerId = str(form, "customerId");
    if (!customerId) {
      const name = str(form, "newCustomerName").trim();
      if (!name) throw new AppError("Choose an existing customer or enter a new customer name.");
      customerId = (await createCustomer(actor, { name, email: str(form, "contactEmail"), phone: str(form, "contactPhone") })).id;
    }
    const contactId = str(form, "contactId");
    const contactName = str(form, "contactName").trim();
    const job = await createJob(actor, {
      customerId,
      contactId: contactId || undefined,
      newContact: !contactId && contactName ? { name: contactName, title: str(form, "contactTitle"), email: str(form, "contactEmail"), phone: str(form, "contactPhone") } : undefined,
      vehicle: { year: str(form, "year"), make: str(form, "make"), model: str(form, "model"), vin: str(form, "vin"), color: str(form, "color"), licensePlate: str(form, "licensePlate") },
      referenceNumber: str(form, "referenceNumber"),
    });
    return { to: `/jobs/${job.id}`, notice: `Job ${job.number} created.` };
  });
}

export async function startDocumentAction(jobId: string, type: DocType) {
  await guard(`/jobs/${jobId}`, async () => {
    await createDocumentDraft(await currentActor(), jobId, type);
    return { to: `/jobs/${jobId}/${docSlug(type)}` };
  });
}

export async function saveDraftAction(jobId: string, type: DocType, versionId: string, form: FormData) {
  const back = `/jobs/${jobId}/${docSlug(type)}`;
  await guard(back, async () => {
    await saveDraft(await currentActor(), versionId, formObject(form));
    return { notice: "Draft saved." };
  });
}

export async function sendAction(jobId: string, type: DocType, versionId: string, form: FormData) {
  const back = `/jobs/${jobId}/${docSlug(type)}`;
  await guard(back, async () => {
    const actor = await currentActor();
    // Save the editor fields first so what is sent is exactly what is on screen.
    if (form.has("serviceCode")) await saveDraft(actor, versionId, formObject(form));
    const res = await sendForSignature(actor, versionId, { toEmail: str(form, "toEmail"), toName: str(form, "toName") });
    return { notice: res.emailSent ? "Sent to the customer." : "Saved, but the email could not be delivered. Copy the link below and send it yourself." };
  });
}

export async function resendAction(jobId: string, type: DocType, versionId: string, form: FormData) {
  const back = `/jobs/${jobId}/${docSlug(type)}`;
  await guard(back, async () => {
    const res = await resendLink(await currentActor(), versionId, { toEmail: str(form, "toEmail"), toName: str(form, "toName") });
    return { notice: res.emailSent ? "New link sent. The previous link no longer works." : "New link created, but the email could not be delivered. Copy it below." };
  });
}

export async function reviseAction(jobId: string, type: DocType, versionId: string) {
  const back = `/jobs/${jobId}/${docSlug(type)}`;
  await guard(back, async () => {
    await reviseVersion(await currentActor(), versionId);
    return { notice: "New version created. Edit it and send it for signature." };
  });
}

export async function discardAction(jobId: string, type: DocType, versionId: string) {
  await guard(`/jobs/${jobId}/${docSlug(type)}`, async () => {
    await discardDraft(await currentActor(), versionId);
    return { to: `/jobs/${jobId}`, notice: "Draft discarded." };
  });
}

export async function paymentAction(jobId: string, form: FormData) {
  await guard(`/jobs/${jobId}`, async () => {
    await recordPayment(await currentActor(), jobId, formObject(form));
    return { notice: "Payment recorded." };
  });
}

export async function cancelJobAction(jobId: string, form: FormData) {
  await guard(`/jobs/${jobId}`, async () => {
    await cancelJob(await currentActor(), jobId, str(form, "reason").trim() || null);
    return { notice: "Job cancelled." };
  });
}

export async function uploadPhotoAction(jobId: string, form: FormData) {
  await guard(`/jobs/${jobId}`, async () => {
    const actor = await currentActor();
    const kind = str(form, "kind");
    const files = form.getAll("photo").filter((f): f is File => f instanceof File && f.size > 0);
    if (files.length === 0) throw new AppError("Choose a photo to upload.");
    for (const f of files) {
      await addPhoto(actor, jobId, { kind: kind === "BEFORE" || kind === "AFTER" ? kind : "OTHER", caption: str(form, "caption"), data: new Uint8Array(await f.arrayBuffer()) });
    }
    return { notice: files.length === 1 ? "Photo added." : `${files.length} photos added.` };
  });
}

export async function deletePhotoAction(jobId: string, photoId: string) {
  await guard(`/jobs/${jobId}`, async () => {
    await deletePhoto(await currentActor(), photoId);
    return { notice: "Photo removed." };
  });
}
