"use client";
import { useFormStatus } from "react-dom";
import { btnClass } from "@/components/ui";

export function SubmitButton({
  children,
  variant = "primary",
  pendingText = "Working...",
  confirm,
  className = "",
  formAction,
}: {
  children: React.ReactNode;
  variant?: "primary" | "secondary" | "danger";
  pendingText?: string;
  confirm?: string;
  className?: string;
  formAction?: (formData: FormData) => void | Promise<void>;
}) {
  const { pending } = useFormStatus();
  return (
    <button
      type="submit"
      formAction={formAction}
      disabled={pending}
      className={btnClass(variant, className)}
      onClick={(e) => {
        if (confirm && !window.confirm(confirm)) e.preventDefault();
      }}
    >
      {pending ? pendingText : children}
    </button>
  );
}
