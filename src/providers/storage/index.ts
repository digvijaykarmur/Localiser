import fs from "node:fs/promises";
import path from "node:path";
import { createReadStream, existsSync } from "node:fs";
import { env } from "@/lib/env";

export interface StoragePort {
  put(key: string, data: Buffer | string): Promise<string>;
  get(key: string): Promise<Buffer>;
  getPath(key: string): string;
  exists(key: string): Promise<boolean>;
  abs(key: string): string;
}

function root() {
  return path.resolve(process.cwd(), env.STORAGE_ROOT);
}

export class FilesystemStorage implements StoragePort {
  abs(key: string): string {
    const resolved = path.resolve(root(), key);
    if (!resolved.startsWith(root())) throw new Error("storage key escapes root");
    return resolved;
  }

  getPath(key: string): string {
    return this.abs(key);
  }

  async put(key: string, data: Buffer | string): Promise<string> {
    const dest = this.abs(key);
    await fs.mkdir(path.dirname(dest), { recursive: true });
    await fs.writeFile(dest, data);
    return dest;
  }

  async get(key: string): Promise<Buffer> {
    return fs.readFile(this.abs(key));
  }

  async exists(key: string): Promise<boolean> {
    return existsSync(this.abs(key));
  }
}

export const storage: StoragePort = new FilesystemStorage();

export function readStream(key: string) {
  return createReadStream(storage.abs(key));
}
