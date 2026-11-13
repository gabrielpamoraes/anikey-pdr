"use client";
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { SignaturePad } from "@/components/signature-pad";
import { signAction } from "@/app/s/[token]/actions";
import { btnClass, inputClass } from "@/components/ui";

export function SignForm({ token, label, defaultName, showExceptions }: { token: string; label: string; defaultName: string; showExceptions: boolean }) {
  const router = useRouter();
  const [name, setName] = useState(defaultName);
  const [title, setTitle] = useState("");
  const [exceptions, setExceptions] = useState("");
  const [authority, setAuthority] = useState(false);
  const [signature, setSignature] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();

  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    if (!signature) return setError("Please sign in the box.");
    start(async () => {
      const res = await signAction(token, { signerName: name, signerTitle: title, authorityConfirmed: authority, exceptions, signatureDataUrl: signature });
      if (res.ok) router.refresh();
      else setError(res.error);
    });
  };

  return (
    <form onSubmit={submit} className="space-y-4">
      {error && <div role="alert" className="rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-800">{error}</div>}
      <div className="grid gap-3 sm:grid-cols-2">
        <label className="block"><span className="mb-1 block text-sm font-medium">Printed name</span><input value={name} onChange={(e) => setName(e.target.value)} required autoComplete="name" className={inputClass} /></label>
        <label className="block"><span className="mb-1 block text-sm font-medium">Title (optional)</span><input value={title} onChange={(e) => setTitle(e.target.value)} className={inputClass} /></label>
      </div>
      {showExceptions && (
        <label className="block"><span className="mb-1 block text-sm font-medium">Exceptions or notes (optional)</span><textarea value={exceptions} onChange={(e) => setExceptions(e.target.value)} rows={3} maxLength={2000} className={inputClass} /></label>
      )}
      <SignaturePad onChange={setSignature} />
      <label className="flex items-start gap-2 text-sm text-gray-800">
        <input type="checkbox" checked={authority} onChange={(e) => setAuthority(e.target.checked)} className="mt-0.5 size-5" />
        <span>I am authorized to sign this document on behalf of the customer, and I agree to its terms.</span>
      </label>
      <button disabled={pending} className={btnClass("primary", "w-full")}>{pending ? "Signing..." : label}</button>
    </form>
  );
}
