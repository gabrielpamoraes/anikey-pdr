import type { StorageProvider, StoredObject } from "./index";

/**
 * Supabase Storage through its REST API (no SDK needed). Use a PRIVATE bucket; files are only ever
 * served through authenticated app routes or valid signing links.
 *
 * Env: SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY (server only, never exposed to the browser), SUPABASE_STORAGE_BUCKET.
 */
export class SupabaseStorageProvider implements StorageProvider {
  readonly name = "supabase";
  private readonly baseUrl: string;
  private readonly key: string;
  private readonly bucket: string;

  constructor() {
    const url = process.env.SUPABASE_URL;
    const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
    if (!url || !key) throw new Error("SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY are required");
    this.baseUrl = url.replace(/\/+$/, "");
    this.key = key;
    this.bucket = process.env.SUPABASE_STORAGE_BUCKET ?? "anikey-private";
  }

  private url(path: string): string {
    const encoded = path.split("/").map(encodeURIComponent).join("/");
    return `${this.baseUrl}/storage/v1/object/${this.bucket}/${encoded}`;
  }

  private headers(extra: Record<string, string> = {}): Record<string, string> {
    return { Authorization: `Bearer ${this.key}`, apikey: this.key, ...extra };
  }

  async put(path: string, data: Uint8Array, contentType: string): Promise<void> {
    const res = await fetch(this.url(path), {
      method: "POST",
      headers: this.headers({ "Content-Type": contentType, "x-upsert": "true" }),
      body: Buffer.from(data),
    });
    if (!res.ok) throw new Error(`Supabase storage upload failed (${res.status})`);
  }

  async get(path: string): Promise<StoredObject | null> {
    const res = await fetch(this.url(path), { headers: this.headers() });
    if (res.status === 404 || res.status === 400) return null;
    if (!res.ok) throw new Error(`Supabase storage download failed (${res.status})`);
    return {
      data: new Uint8Array(await res.arrayBuffer()),
      contentType: res.headers.get("content-type") ?? "application/octet-stream",
    };
  }

  async delete(path: string): Promise<void> {
    const res = await fetch(this.url(path), { method: "DELETE", headers: this.headers() });
    if (!res.ok && res.status !== 404) throw new Error(`Supabase storage delete failed (${res.status})`);
  }
}
