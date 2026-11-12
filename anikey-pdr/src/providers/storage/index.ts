import { LocalStorageProvider } from "./local";
import { MemoryStorageProvider } from "./memory";
import { SupabaseStorageProvider } from "./supabase";

export interface StoredObject {
  data: Uint8Array;
  contentType: string;
}

/** Where binary files live (signed PDFs, signature images, job photos). Swap implementations by env. */
export interface StorageProvider {
  readonly name: string;
  put(path: string, data: Uint8Array, contentType: string): Promise<void>;
  get(path: string): Promise<StoredObject | null>;
  delete(path: string): Promise<void>;
}

let instance: StorageProvider | null = null;

export function getStorage(): StorageProvider {
  if (instance) return instance;
  switch (process.env.STORAGE_PROVIDER ?? "local") {
    case "supabase":
      instance = new SupabaseStorageProvider();
      break;
    case "memory":
      instance = new MemoryStorageProvider();
      break;
    default:
      instance = new LocalStorageProvider(process.env.LOCAL_STORAGE_DIR ?? ".storage");
  }
  return instance;
}

/** Test seam. */
export function setStorage(provider: StorageProvider | null): void {
  instance = provider;
}

export const storageKeys = {
  signature: (orgId: string, jobId: string, versionId: string) =>
    `${orgId}/jobs/${jobId}/signatures/${versionId}.png`,
  signedPdf: (orgId: string, jobId: string, number: string, version: number) =>
    `${orgId}/jobs/${jobId}/documents/${number}-v${version}.pdf`,
  photo: (orgId: string, jobId: string, photoId: string, ext: string) =>
    `${orgId}/jobs/${jobId}/photos/${photoId}.${ext}`,
};
