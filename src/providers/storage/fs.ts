import fs from "node:fs/promises";
import path from "node:path";
import type { StoragePort } from "../ports";

/** Filesystem adapter. Keys are POSIX-style relative paths under the root. */
export class FsStorage implements StoragePort {
  constructor(private readonly root: string) {}

  private abs(key: string): string {
    const safe = key.replace(/\\/g, "/").replace(/^\/+/, "");
    const p = path.resolve(this.root, safe);
    if (!p.startsWith(path.resolve(this.root))) throw new Error(`storage key escapes root: ${key}`);
    return p;
  }

  async put(key: string, body: Buffer, _contentType: string): Promise<void> {
    const p = this.abs(key);
    await fs.mkdir(path.dirname(p), { recursive: true });
    const tmp = `${p}.partial`;
    await fs.writeFile(tmp, body);
    await fs.rename(tmp, p);
  }

  async get(key: string): Promise<Buffer> {
    return fs.readFile(this.abs(key));
  }

  async exists(key: string): Promise<boolean> {
    try {
      await fs.access(this.abs(key));
      return true;
    } catch {
      return false;
    }
  }

  async url(key: string): Promise<string> {
    return `/media/${key.replace(/^\/+/, "")}`;
  }

  async localPath(key: string): Promise<string> {
    const p = this.abs(key);
    await fs.mkdir(path.dirname(p), { recursive: true });
    return p;
  }

  async list(prefix: string): Promise<string[]> {
    const dir = this.abs(prefix);
    try {
      const entries = await fs.readdir(dir, { withFileTypes: true, recursive: true });
      return entries
        .filter((e) => e.isFile() && !e.name.endsWith(".partial"))
        .map((e) => path.relative(this.root, path.join(e.parentPath ?? e.path, e.name)).replace(/\\/g, "/"));
    } catch {
      return [];
    }
  }

  async delete(key: string): Promise<void> {
    await fs.rm(this.abs(key), { force: true });
  }

  /** Remove `.partial` leftovers from a crashed worker (§25). */
  async cleanPartials(): Promise<number> {
    let n = 0;
    const walk = async (dir: string) => {
      let entries: import("node:fs").Dirent[] = [];
      try {
        entries = await fs.readdir(dir, { withFileTypes: true });
      } catch {
        return;
      }
      for (const e of entries) {
        const p = path.join(dir, e.name);
        if (e.isDirectory()) await walk(p);
        else if (e.name.endsWith(".partial")) {
          await fs.rm(p, { force: true });
          n++;
        }
      }
    };
    await walk(this.root);
    return n;
  }
}
