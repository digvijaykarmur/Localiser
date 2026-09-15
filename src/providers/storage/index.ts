import { env, STORAGE_ROOT_ABS } from "@/config/env";
import type { StoragePort } from "../ports";
import { FsStorage } from "./fs";
import { GcsStorage } from "./gcs";

let instance: StoragePort | null = null;

export function storage(): StoragePort {
  if (instance) return instance;
  if (env.STORAGE_DRIVER === "gcs") {
    if (!env.GCS_BUCKET) throw new Error("STORAGE_DRIVER=gcs requires GCS_BUCKET");
    instance = new GcsStorage(env.GCS_BUCKET, async () => {
      const r = await fetch("http://metadata.google.internal/computeMetadata/v1/instance/service-accounts/default/token", {
        headers: { "Metadata-Flavor": "Google" },
      });
      if (!r.ok) throw new Error("GCS token: metadata server unavailable; run on GCP or use STORAGE_DRIVER=fs");
      return ((await r.json()) as { access_token: string }).access_token;
    });
  } else {
    instance = new FsStorage(STORAGE_ROOT_ABS);
  }
  return instance;
}

export { FsStorage, GcsStorage };

export const keys = {
  master: (titleId: string) => `titles/${titleId}/master.mp4`,
  frame: (titleId: string, seq: number, i: number) => `titles/${titleId}/frames/${String(seq).padStart(4, "0")}_${i}.jpg`,
  asset: (jobId: string, kind: string, name: string) => `jobs/${jobId}/assets/${kind}/${name}`,
  render: (jobId: string, ratio: string) => `jobs/${jobId}/render/${ratio.replace(":", "x")}.mp4`,
  renderRaw: (jobId: string, ratio: string) => `jobs/${jobId}/render/${ratio.replace(":", "x")}.raw.mp4`,
  qcFrames: (jobId: string, ratio: string) => `jobs/${jobId}/qc/${ratio.replace(":", "x")}/frames`,
  raw: (jobId: string, stage: string, attempt: number) => `jobs/${jobId}/raw/${stage}_${attempt}.txt`,
  export: (promoId: string, file: string) => `exports/${promoId}/${file}`,
};
