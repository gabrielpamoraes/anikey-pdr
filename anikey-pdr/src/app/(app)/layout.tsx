import Link from "next/link";
import { requireUser } from "@/lib/session";
import { logoutAction } from "../login/actions";

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const user = await requireUser();
  const nav = [
    { href: "/jobs", label: "Jobs" },
    { href: "/customers", label: "Customers" },
    ...(user.role === "ADMIN" ? [{ href: "/settings", label: "Settings" }, { href: "/audit", label: "Audit" }] : []),
  ];
  return (
    <>
      <header className="sticky top-0 z-10 border-b border-gray-200 bg-white">
        <div className="mx-auto flex max-w-5xl items-center justify-between gap-3 px-4 py-2">
          <Link href="/jobs" className="text-sm font-bold tracking-widest text-gray-900">ANIKEY</Link>
          <nav className="flex flex-1 gap-1 overflow-x-auto">
            {nav.map((n) => (
              <Link key={n.href} href={n.href} className="rounded-lg px-3 py-2 text-sm font-medium text-gray-700 hover:bg-gray-100">
                {n.label}
              </Link>
            ))}
          </nav>
          <form action={logoutAction} className="flex items-center gap-2">
            <span className="hidden text-xs text-gray-500 sm:inline">{user.name}</span>
            <button className="rounded-lg px-3 py-2 text-sm text-gray-600 hover:bg-gray-100">Sign out</button>
          </form>
        </div>
      </header>
      <main className="mx-auto max-w-5xl px-4 py-6">{children}</main>
    </>
  );
}
