import type { EmailMessage, EmailProvider } from "./index";

/** Test provider that records what would have been sent. */
export class MemoryEmailProvider implements EmailProvider {
  readonly name = "memory";
  readonly sent: EmailMessage[] = [];
  failNext = false;

  async send(message: EmailMessage): Promise<void> {
    if (this.failNext) {
      this.failNext = false;
      throw new Error("simulated email failure");
    }
    this.sent.push(message);
  }

  clear(): void {
    this.sent.length = 0;
  }
}
