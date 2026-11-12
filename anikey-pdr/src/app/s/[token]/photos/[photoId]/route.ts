import { getPublicPhoto } from "@/services/signing";

export const dynamic = "force-dynamic";

export async function GET(_req: Request, { params }: { params: Promise<{ token: string; photoId: string }> }) {
  const { token, photoId } = await params;
  const photo = await getPublicPhoto(token, photoId);
  if (!photo) return new Response("Not found", { status: 404 });
  return new Response(Buffer.from(photo.data), { headers: { "Content-Type": photo.contentType, "Cache-Control": "private, no-store", "X-Content-Type-Options": "nosniff" } });
}
