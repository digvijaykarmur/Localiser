import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import type { StoragePort } from "../ports";

/**
 * GCS adapter via the JSON API with an access token from the metadata server or
 * GOOGLE_APPLICATION_CREDENTIALS (service account JWT). Kept dependency-free; M7 concern.
 */
export class GcsStorage implements StoragePort {
  private cache = path.join(os.tmpdir(), "promo-gcs-cache");
  constructor(
    private readonly bucket: string,
    private readonly token: () => Promise<string>,
  ) {}

  private objectUrl(key: string) {
    return `https://storage.googleapis.com/storage/v1/b/${this.bucket}/o/${encodeURIComponent(key)}`;
  }

  async put(key: string, body: Buffer, contentType: string): Promise<void> {
    const res = await fetch(`https://storage.googleapis.com/upload/storage/v1/b/${this.bucket}/o?uploadType=media&name=${encodeURIComponent(key)}`, {
      method: "POST",
      headers: { Authorization: `Bearer ${await this.token()}`, "Content-Type": contentType },
      body: new Uint8Array(body),
    });
    if (!res.ok) throw new Error(`GCS put ${key}: ${res.status} ${await res.text()}`);
  }

  async get(key: string): Promise<Buffer> {
    const res = await fetch(`${this.objectUrl(key)}?alt=media`, { headers: { Authorization: `Bearer ${await this.token()}` } });
    if (!res.ok) throw new Error(`GCS get ${key}: ${res.status}`);
    return Buffer.from(await res.arrayBuffer());
  }

  async exists(key: string): Promise<boolean> {
    const res = await fetch(this.objectUrl(key), { headers: { Authorization: `Bearer ${await this.token()}` } });
    return res.ok;
  }

  async url(key: string): Promise<string> {
    return `/media/${key}`;
  }

  async localPath(key: string): Promise<string> {
    const p = path.join(this.cache, key);
    await fs.mkdir(path.dirname(p), { recursive: true });
    if (await this.exists(key)) await fs.writeFile(p, await this.get(key));
    return p;
  }

  async list(prefix: string): Promise<string[]> {
    const res = await fetch(`https://storage.googleapis.com/storage/v1/b/${this.bucket}/o?prefix=${encodeURIComponent(prefix)}`, {
      headers: { Authorization: `Bearer ${await this.token()}` },
    });
    if (!res.ok) return [];
    const j = (await res.json()) as { items?: { name: string }[] };
    return (j.items ?? []).map((i) => i.name);
  }

  async delete(key: string): Promise<void> {
    await fetch(this.objectUrl(key), { method: "DELETE", headers: { Authorization: `Bearer ${await this.token()}` } });
  }
}
