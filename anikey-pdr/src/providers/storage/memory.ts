import type { StorageProvider, StoredObject } from "./index";

/** In-memory storage for tests. */
export class MemoryStorageProvider implements StorageProvider {
  readonly name = "memory";
  readonly files = new Map<string, StoredObject>();

  async put(path: string, data: Uint8Array, contentType: string): Promise<void> {
    this.files.set(path, { data, contentType });
  }

  async get(path: string): Promise<StoredObject | null> {
    return this.files.get(path) ?? null;
  }

  async delete(path: string): Promise<void> {
    this.files.delete(path);
  }
}
