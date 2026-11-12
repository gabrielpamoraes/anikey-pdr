import { getPublicPdf } from "@/services/signing";

export const dynamic = "force-dynamic";

export async function GET(_req: Request, { params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  const file = await getPublicPdf(token);
  if (!file) return new Response("Not found", { status: 404 });
  return new Response(Buffer.from(file.bytes), { headers: { "Content-Type": "application/pdf", "Content-Disposition": `inline; filename="${file.filename}"`, "Cache-Control": "private, no-store" } });
}
