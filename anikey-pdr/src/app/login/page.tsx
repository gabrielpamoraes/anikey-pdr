import { redirect } from "next/navigation";
import { getSessionUser } from "@/lib/session";
import { Card, Field, Flash, flashOf, inputClass, type SP } from "@/components/ui";
import { SubmitButton } from "@/components/submit-button";
import { loginAction } from "./actions";

export const metadata = { title: "Sign in" };

export default async function LoginPage({ searchParams }: { searchParams: SP }) {
  if (await getSessionUser()) redirect("/jobs");
  const { error } = await flashOf(searchParams);
  return (
    <main className="mx-auto flex min-h-screen max-w-sm flex-col justify-center px-4">
      <div className="mb-6 text-center">
        <div className="text-xs font-bold tracking-[0.2em] text-gray-500">ANIKEY LLC</div>
        <h1 className="mt-1 text-2xl font-bold">PDR work orders</h1>
      </div>
      <Card>
        <Flash error={error} />
        <form action={loginAction} className="space-y-4">
          <Field label="Email">
            <input name="email" type="email" autoComplete="username" required className={inputClass} />
          </Field>
          <Field label="Password">
            <input name="password" type="password" autoComplete="current-password" required className={inputClass} />
          </Field>
          <SubmitButton className="w-full" pendingText="Signing in...">Sign in</SubmitButton>
        </form>
      </Card>
    </main>
  );
}
