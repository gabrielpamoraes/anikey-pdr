import { ConsoleEmailProvider } from "./console";
import { MemoryEmailProvider } from "./memory";
import { ResendEmailProvider } from "./resend";

export interface EmailAttachment {
  filename: string;
  content: Uint8Array;
  contentType: string;
}

export interface EmailMessage {
  to: string;
  subject: string;
  text: string;
  html: string;
  attachments?: EmailAttachment[];
}

/** Outbound e-mail. All sending goes through this interface (a queue-backed implementation can replace it). */
export interface EmailProvider {
  readonly name: string;
  send(message: EmailMessage): Promise<void>;
}

let instance: EmailProvider | null = null;

export function getEmail(): EmailProvider {
  if (instance) return instance;
  switch (process.env.EMAIL_PROVIDER ?? "console") {
    case "resend":
      instance = new ResendEmailProvider();
      break;
    case "memory":
      instance = new MemoryEmailProvider();
      break;
    default:
      instance = new ConsoleEmailProvider();
  }
  return instance;
}

/** Test seam. */
export function setEmail(provider: EmailProvider | null): void {
  instance = provider;
}
