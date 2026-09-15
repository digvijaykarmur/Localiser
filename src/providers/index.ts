import { env, providerModes } from "@/config/env";
import type { AntryamiPort, ClickHousePort, ElevenLabsPort, VertexPort } from "./ports";
import { SnapshotAntryami, SnapshotClickHouse } from "./snapshot/antryami";
import { SnapshotElevenLabs } from "./snapshot/elevenlabs";
import { SnapshotVertex } from "./snapshot/vertex";

export * from "./ports";
export { storage, keys } from "./storage";

let vertexInstance: VertexPort | null = null;
let elevenInstance: ElevenLabsPort | null = null;
let antryamiInstance: AntryamiPort | null = null;
let clickhouseInstance: ClickHousePort | null = null;

export async function vertex(): Promise<VertexPort> {
  if (vertexInstance) return vertexInstance;
  if (providerModes().vertex === "real") {
    const { RealVertex } = await import("./vertex/real");
    vertexInstance = new RealVertex();
  } else vertexInstance = new SnapshotVertex();
  return vertexInstance;
}

export async function elevenlabs(): Promise<ElevenLabsPort> {
  if (elevenInstance) return elevenInstance;
  if (providerModes().elevenlabs === "real") {
    const { RealElevenLabs } = await import("./elevenlabs/real");
    elevenInstance = new RealElevenLabs(env.ELEVENLABS_API_KEY!);
  } else elevenInstance = new SnapshotElevenLabs();
  return elevenInstance;
}

export async function antryami(): Promise<AntryamiPort> {
  if (antryamiInstance) return antryamiInstance;
  if (providerModes().antryami === "real") {
    const { RealAntryami } = await import("./antryami/real");
    antryamiInstance = new RealAntryami(env.ANTRYAMI_BASE_URL!, env.ANTRYAMI_TOKEN);
  } else antryamiInstance = new SnapshotAntryami();
  return antryamiInstance;
}

export async function clickhouse(): Promise<ClickHousePort> {
  if (clickhouseInstance) return clickhouseInstance;
  if (providerModes().clickhouse === "real") {
    const { RealClickHouse } = await import("./clickhouse/real");
    clickhouseInstance = new RealClickHouse(env.CLICKHOUSE_URL!, env.CLICKHOUSE_USER, env.CLICKHOUSE_PASSWORD);
  } else clickhouseInstance = new SnapshotClickHouse();
  return clickhouseInstance;
}

export type ChipState = { name: string; state: "ok" | "snapshot" | "error"; detail: string };

/** The four connection chips (§5 step 3). Never a generic "connection failed". */
export async function checkConnections(): Promise<ChipState[]> {
  const modes = providerModes();
  const out: ChipState[] = [];

  const a = await antryami();
  const ap = await a.ping();
  out.push({ name: "Antryami", state: modes.antryami === "snapshot" ? "snapshot" : ap.ok ? "ok" : "error", detail: modes.antryami === "snapshot" ? "Snapshot mode: reading src/data/snapshots" : ap.ok ? env.ANTRYAMI_BASE_URL! : (ap.error ?? "unknown error") });

  const c = await clickhouse();
  const cp = await c.ping();
  out.push({ name: "ClickHouse", state: modes.clickhouse === "snapshot" ? "snapshot" : cp.ok ? "ok" : "error", detail: modes.clickhouse === "snapshot" ? "Snapshot mode: fixture scenes and performance" : cp.ok ? env.CLICKHOUSE_URL! : (cp.error ?? "unknown error") });

  if (modes.vertex === "snapshot") {
    out.push({ name: "Vertex", state: "snapshot", detail: env.SNAPSHOT_MODE ? "SNAPSHOT_MODE=true" : "No GEMINI_API_KEY or VERTEX_PROJECT+GOOGLE_APPLICATION_CREDENTIALS — models stubbed" });
  } else {
    try {
      const v = await vertex();
      const { models } = await import("@/config/models");
      const r = await v.canary(models.judge.model);
      out.push({ name: "Vertex", state: r.ok ? "ok" : "error", detail: r.ok ? `${models.judge.model} responded in ${r.latency_ms}ms` : (r.error ?? "unknown error") });
    } catch (e) {
      out.push({ name: "Vertex", state: "error", detail: e instanceof Error ? e.message : String(e) });
    }
  }

  const el = await elevenlabs();
  const ep = await el.ping();
  out.push({ name: "ElevenLabs", state: modes.elevenlabs === "snapshot" ? "snapshot" : ep.ok ? "ok" : "error", detail: modes.elevenlabs === "snapshot" ? "No ELEVENLABS_API_KEY — VO and music stubbed with tones" : ep.ok ? "API key valid" : (ep.error ?? "unknown error") });

  return out;
}
