import { env, providers } from "@/lib/env";

function pill(live: boolean, label: string) {
  return `${label} ${live ? "live" : "snapshot"}`;
}

export function ProviderStatus() {
  const mode = env.SNAPSHOT_MODE ? "offline snapshot" : "production adapters";
  return (
    <div className="muted" style={{ fontSize: 12 }}>
      {mode}
      {" · "}
      {pill(providers.vertex, "Vertex")}
      {" · "}
      {pill(providers.elevenlabs, "ElevenLabs")}
      {" · "}
      {pill(providers.clickhouse, "ClickHouse")}
      {" · "}
      {pill(providers.antryami, "Antryami")}
    </div>
  );
}
