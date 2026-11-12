import Link from "next/link";
import type { Tone } from "@/domain/labels";

const TONES: Record<Tone, string> = {
  neutral: "bg-gray-100 text-gray-700",
  amber: "bg-amber-100 text-amber-800",
  violet: "bg-violet-100 text-violet-800",
  blue: "bg-blue-100 text-blue-800",
  green: "bg-green-100 text-green-800",
  red: "bg-red-100 text-red-800",
};

export function Badge({ tone = "neutral", children }: { tone?: Tone; children: React.ReactNode }) {
  return <span className={`inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-semibold ${TONES[tone]}`}>{children}</span>;
}

export function Card({ title, action, children, className = "" }: { title?: string; action?: React.ReactNode; children: React.ReactNode; className?: string }) {
  return (
    <section className={`rounded-xl border border-gray-200 bg-white p-4 shadow-sm ${className}`}>
      {(title || action) && (
        <div className="mb-3 flex items-center justify-between gap-2">
          {title && <h2 className="text-sm font-semibold uppercase tracking-wide text-gray-500">{title}</h2>}
          {action}
        </div>
      )}
      {children}
    </section>
  );
}

export function Flash({ error, notice }: { error?: string; notice?: string }) {
  if (!error && !notice) return null;
  return (
    <div role={error ? "alert" : "status"} className={`mb-4 rounded-lg border px-4 py-3 text-sm ${error ? "border-red-200 bg-red-50 text-red-800" : "border-green-200 bg-green-50 text-green-800"}`}>
      {error ?? notice}
    </div>
  );
}

export const inputClass =
  "block w-full rounded-lg border border-gray-300 bg-white px-3 py-2.5 text-base text-gray-900 shadow-sm focus:border-blue-600 focus:outline-none focus:ring-2 focus:ring-blue-200 disabled:bg-gray-50";

export function Field({ label, hint, children }: { label: string; hint?: string; children: React.ReactNode }) {
  return (
    <label className="block">
      <span className="mb-1 block text-sm font-medium text-gray-700">{label}</span>
      {children}
      {hint && <span className="mt-1 block text-xs text-gray-500">{hint}</span>}
    </label>
  );
}

const BTN = {
  primary: "bg-blue-700 text-white hover:bg-blue-800",
  secondary: "border border-gray-300 bg-white text-gray-800 hover:bg-gray-50",
  danger: "border border-red-300 bg-white text-red-700 hover:bg-red-50",
} as const;

export function btnClass(variant: keyof typeof BTN = "primary", extra = "") {
  return `inline-flex min-h-11 items-center justify-center rounded-lg px-4 py-2 text-sm font-semibold transition-colors disabled:opacity-50 ${BTN[variant]} ${extra}`;
}

export function LinkButton({ href, variant = "secondary", children, className = "" }: { href: string; variant?: keyof typeof BTN; children: React.ReactNode; className?: string }) {
  return (
    <Link href={href} className={btnClass(variant, className)}>
      {children}
    </Link>
  );
}

export function PageTitle({ children, sub, action }: { children: React.ReactNode; sub?: React.ReactNode; action?: React.ReactNode }) {
  return (
    <div className="mb-4 flex flex-wrap items-start justify-between gap-3">
      <div>
        <h1 className="text-2xl font-bold text-gray-900">{children}</h1>
        {sub && <div className="mt-1 text-sm text-gray-600">{sub}</div>}
      </div>
      {action}
    </div>
  );
}

export function DL({ rows }: { rows: [string, React.ReactNode][] }) {
  return (
    <dl className="grid grid-cols-1 gap-x-6 gap-y-2 text-sm sm:grid-cols-2">
      {rows.map(([k, v]) => (
        <div key={k}>
          <dt className="text-xs font-medium uppercase tracking-wide text-gray-500">{k}</dt>
          <dd className="text-gray-900">{v ?? "-"}</dd>
        </div>
      ))}
    </dl>
  );
}

export type SP = Promise<Record<string, string | string[] | undefined>>;
export async function flashOf(sp: SP) {
  const p = await sp;
  const one = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v);
  return { error: one(p.error), notice: one(p.notice), q: one(p.q), filter: one(p.filter), v: one(p.v), customer: one(p.customer) };
}
