import { db } from "@/lib/db";
import { getSessionUser } from "@/lib/session";
import { getStorage } from "@/providers/storage";

export const dynamic = "force-dynamic";

export async function GET(_req: Request, { params }: { params: Promise<{ photoId: string }> }) {
  const user = await getSessionUser();
  if (!user) return new Response("Unauthorized", { status: 401 });
  const { photoId } = await params;
  const photo = await db.photo.findFirst({ where: { id: photoId, job: { orgId: user.orgId } } });
  if (!photo) return new Response("Not found", { status: 404 });
  const stored = await getStorage().get(photo.storagePath);
  if (!stored) return new Response("Not found", { status: 404 });
  return new Response(Buffer.from(stored.data), { headers: { "Content-Type": photo.contentType, "Cache-Control": "private, max-age=300", "X-Content-Type-Options": "nosniff" } });
}
