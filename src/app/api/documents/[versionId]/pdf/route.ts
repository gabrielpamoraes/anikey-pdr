import { getSessionUser } from "@/lib/session";
import { getVersionPdf, orgIdOfVersion } from "@/services/pdf";

export const dynamic = "force-dynamic";

export async function GET(_req: Request, { params }: { params: Promise<{ versionId: string }> }) {
  const user = await getSessionUser();
  if (!user) return new Response("Unauthorized", { status: 401 });
  const { versionId } = await params;
  // 404 (not 403) for other organizations' documents so ids cannot be probed.
  if ((await orgIdOfVersion(versionId)) !== user.orgId) return new Response("Not found", { status: 404 });
  const file = await getVersionPdf(versionId);
  return new Response(Buffer.from(file.bytes), {
    headers: { "Content-Type": "application/pdf", "Content-Disposition": `inline; filename="${file.filename}"`, "Cache-Control": "private, no-store" },
  });
}
