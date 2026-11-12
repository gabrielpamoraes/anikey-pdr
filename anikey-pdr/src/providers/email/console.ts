import type { EmailMessage, EmailProvider } from "./index";

/** Development provider: prints the message (including any signing link) to the server log. */
export class ConsoleEmailProvider implements EmailProvider {
  readonly name = "console";

  async send(message: EmailMessage): Promise<void> {
    const attachments = (message.attachments ?? []).map((a) => `${a.filename} (${a.content.length} bytes)`);
    console.log(
      [
        "---------- EMAIL (console provider) ----------",
        `To: ${message.to}`,
        `Subject: ${message.subject}`,
        "",
        message.text,
        attachments.length ? `\nAttachments: ${attachments.join(", ")}` : "",
        "----------------------------------------------",
      ].join("\n"),
    );
  }
}
