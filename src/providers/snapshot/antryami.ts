import { PromoError, RawScene, Title, type DialectCode, type Page } from "@/domain";
import type { AntryamiPort, ClickHousePort, PerformanceRow } from "../ports";
import { readJson, snapshotExists, snapshotPath } from "./fixtures";

export class SnapshotAntryami implements AntryamiPort {
  readonly mode = "snapshot" as const;

  private titles(): Title[] {
    return readJson<unknown[]>("titles.json", []).map((t) => Title.parse(t));
  }

  async listTitles(args: { dialect?: DialectCode }): Promise<Page<Title>> {
    const items = this.titles().filter((t) => !args.dialect || t.dialect === args.dialect);
    return { items, next_cursor: null };
  }

  async getTitle(id: string): Promise<Title> {
    const t = this.titles().find((x) => x.id === id);
    if (!t) throw new PromoError("NOT_FOUND", `Snapshot title ${id} not found in src/data/snapshots/titles.json`);
    return t;
  }

  async getScenes(id: string): Promise<RawScene[]> {
    return readJson<unknown[]>(`titles/${id}/scenes.json`, []).map((s) => RawScene.parse(s));
  }

  async getMasterUrl(id: string): Promise<string> {
    const rel = `media/${id}.mp4`;
    if (!snapshotExists(rel))
      throw new PromoError("ASSUMPTION_VIOLATED", `Snapshot master for ${id} missing.`, {
        recovery: "Run `pnpm snapshot:build` to generate the synthetic masters under src/data/snapshots/media/.",
      });
    return snapshotPath(rel);
  }

  async ping() {
    return snapshotExists("titles.json") ? { ok: true } : { ok: false, error: "src/data/snapshots/titles.json missing" };
  }
}

export class SnapshotClickHouse implements ClickHousePort {
  readonly mode = "snapshot" as const;

  async getScenes(titleId: string): Promise<RawScene[]> {
    return readJson<unknown[]>(`titles/${titleId}/scenes.json`, []).map((s) => RawScene.parse(s));
  }

  async getPromoPerformance(): Promise<PerformanceRow[]> {
    return readJson<PerformanceRow[]>("performance.json", []);
  }

  async ping() {
    return { ok: true };
  }
}
