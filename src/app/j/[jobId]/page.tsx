"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type { LedgerRow, PromoJob, ReasonCode, Timeline } from "@/domain";

const VERDICTS = [
  { id: "approved", label: "Approved", key: "1" },
  { id: "minor_edit", label: "Minor", key: "2" },
  { id: "major_edit", label: "Major", key: "3" },
  { id: "rejected", label: "Rejected", key: "4" },
] as const;

const REASONS: ReasonCode[] = [
  "R01_WRONG_CLAIM",
  "R02_SPOILER",
  "R03_CROP_CUT_SUBJECT",
  "R04_AUDIO_SYNC",
  "R05_DIALECT_OFF",
  "R06_PACING",
  "R07_WEAK_HOOK",
  "R08_TEXT_UNSAFE",
  "R09_CTA_WRONG",
  "R10_LOW_QUALITY",
  "R11_MUSIC_CLASH",
  "R12_LIPSYNC",
  "R13_WRONG_EVIDENCE",
  "R14_BORING",
];

const RATIOS = ["9:16", "16:9", "1:1"] as const;

export default function JobPage({ params }: { params: { jobId: string } }) {
  const [tab, setTab] = useState<"plan" | "timeline" | "preview" | "review">("preview");
  const [job, setJob] = useState<PromoJob | null>(null);
  const [cost, setCost] = useState(0);
  const [envelope] = useState(12);
  const [timelines, setTimelines] = useState<Record<string, Timeline>>({});
  const [recipeId, setRecipeId] = useState<string | null>(null);
  const [ledgerRows, setLedgerRows] = useState<LedgerRow[]>([]);
  const [codes, setCodes] = useState<ReasonCode[]>([]);
  const [minutes, setMinutes] = useState(0);
  const [note, setNote] = useState("");
  const players = useRef<Record<string, HTMLVideoElement | null>>({});

  const [queuedSince, setQueuedSince] = useState<number | null>(null);

  const refresh = useCallback(async () => {
    const r = await fetch(`/api/v1/jobs/${params.jobId}`);
    const j = await r.json();
    if (!r.ok) return;
    setJob(j.job);
    setCost(j.cost_inr ?? 0);
    setRecipeId(j.job.recipe_id);
    setLedgerRows(j.ledger ?? []);
    if (j.job.status === "queued") {
      setQueuedSince((prev) => prev ?? Date.now());
    } else {
      setQueuedSince(null);
    }
    if (j.job.status === "completed" || j.job.stage === "ASSEMBLE" || j.job.stage === "COMPOSE" || j.job.stage === "QC") {
      const next: Record<string, Timeline> = {};
      for (const ratio of RATIOS) {
        const tr = await fetch(`/api/v1/jobs/${params.jobId}/timeline/${encodeURIComponent(ratio)}`);
        if (tr.ok) {
          const tj = await tr.json();
          next[ratio] = tj.timeline;
        }
      }
      setTimelines(next);
    }
  }, [params.jobId]);

  useEffect(() => {
    void refresh();
    const t = setInterval(() => void refresh(), 1500);
    return () => clearInterval(t);
  }, [refresh]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (tab !== "review") return;
      if (e.code === "Space") {
        e.preventDefault();
        for (const v of Object.values(players.current)) {
          if (!v) continue;
          if (v.paused) void v.play();
          else v.pause();
        }
      }
      const map: Record<string, (typeof VERDICTS)[number]["id"]> = {
        Digit1: "approved",
        Digit2: "minor_edit",
        Digit3: "major_edit",
        Digit4: "rejected",
      };
      const v = map[e.code];
      if (v) void submit(v);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  });

  async function submit(verdict: (typeof VERDICTS)[number]["id"]) {
    await fetch(`/api/v1/jobs/${params.jobId}/review`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        verdict,
        reason_codes: codes,
        edit_minutes: minutes,
        note,
      }),
    });
    await refresh();
  }

  async function retry() {
    await fetch(`/api/v1/jobs/${params.jobId}/retry`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ from_stage: "PLAN" }),
    });
    await refresh();
  }

  const token = (ratio: string) => ratio.replace(":", "x");
  const src = (ratio: string) =>
    recipeId ? `/storage/renders/${recipeId}/${token(ratio)}.mp4` : "";
  const ready = job?.status === "completed";
  const stuckQueued = job?.status === "queued" && queuedSince != null && Date.now() - queuedSince > 8000;

  return (
    <div className="grid" style={{ gap: 16 }}>
      <div className="row" style={{ justifyContent: "space-between" }}>
        <div>
          <h1>Job</h1>
          <div className="muted tabular">
            {job?.status} · {job?.stage} · {job?.progress}%
          </div>
          <div
            style={{
              marginTop: 8,
              height: 6,
              width: 240,
              background: "#121214",
              borderRadius: 99,
              overflow: "hidden",
            }}
          >
            <div
              style={{
                width: `${job?.progress ?? 0}%`,
                height: "100%",
                background: job?.status === "failed" ? "var(--rejected)" : "var(--accent)",
              }}
            />
          </div>
        </div>
        <div className="row">
          {job?.status === "failed" && (
            <button className="btn" onClick={() => void retry()}>
              Retry from PLAN
            </button>
          )}
          <div className="panel" style={{ minWidth: 240 }}>
            <div className="muted">Cost</div>
            <div className="tabular" style={{ fontSize: 22 }}>
              ₹{cost.toFixed(2)} / ₹{envelope}
            </div>
          </div>
        </div>
      </div>
      <div className="row">
        {(["plan", "timeline", "preview", "review"] as const).map((t) => (
          <button key={t} className={`chip ${tab === t ? "on" : ""}`} onClick={() => setTab(t)}>
            {t}
          </button>
        ))}
      </div>
      {stuckQueued && (
        <div className="panel">
          Job is still queued. `pnpm dev` or `pnpm start` must run both Next and the worker.
        </div>
      )}
      {job?.error && (
        <div className="panel">
          Error: {job.error}{" "}
          <button className="btn" style={{ marginLeft: 8 }} onClick={() => void retry()}>
            Retry
          </button>
        </div>
      )}

      {tab === "plan" && (
        <div className="grid" style={{ gridTemplateColumns: "repeat(3, 1fr)" }}>
          {RATIOS.map((ratio) => (
            <div key={ratio} className="panel">
              <h2>{ratio}</h2>
              {(timelines[ratio] ? [] : []).length}
              <PlanBeats jobId={params.jobId} ratio={ratio} />
            </div>
          ))}
        </div>
      )}

      {tab === "timeline" && <TimelineInspector timelines={timelines} />}

      {tab === "preview" && (
        <div className="grid" style={{ gap: 16 }}>
          {!ready && (
            <div className="muted">
              Renders appear here when compose finishes ({job?.stage ?? "…"} {job?.progress ?? 0}%).
            </div>
          )}
          <div className="row" style={{ alignItems: "flex-start", justifyContent: "center", gap: 16 }}>
            <Player
              ratio="16:9"
              src={ready ? src("16:9") : ""}
              width={320}
              height={180}
              register={(el) => (players.current["16:9"] = el)}
            />
            <Player
              ratio="9:16"
              src={ready ? src("9:16") : ""}
              width={270}
              height={480}
              register={(el) => (players.current["9:16"] = el)}
            />
            <Player
              ratio="1:1"
              src={ready ? src("1:1") : ""}
              width={270}
              height={270}
              register={(el) => (players.current["1:1"] = el)}
            />
          </div>
          {ready && recipeId && (
            <div className="row" style={{ justifyContent: "center" }}>
              {RATIOS.map((ratio) => (
                <a key={ratio} className="btn" href={src(ratio)} download>
                  Download {ratio}
                </a>
              ))}
            </div>
          )}
        </div>
      )}

      {tab === "review" && (
        <div className="grid" style={{ gap: 16 }}>
          <div className="row" style={{ alignItems: "flex-start", justifyContent: "center", gap: 16 }}>
            <Player ratio="16:9" src={src("16:9")} width={240} height={135} register={(el) => (players.current["16:9"] = el)} />
            <Player ratio="9:16" src={src("9:16")} width={300} height={533} register={(el) => (players.current["9:16"] = el)} />
            <Player ratio="1:1" src={src("1:1")} width={240} height={240} register={(el) => (players.current["1:1"] = el)} />
          </div>
          <div className="row">
            {VERDICTS.map((v) => (
              <button key={v.id} className={`btn ${v.id}`} onClick={() => void submit(v.id)}>
                {v.key} {v.label}
              </button>
            ))}
          </div>
          <div className="row" style={{ flexWrap: "wrap" }}>
            {REASONS.map((c) => (
              <button
                key={c}
                className={`chip ${codes.includes(c) ? "on" : ""}`}
                onClick={() =>
                  setCodes((prev) => (prev.includes(c) ? prev.filter((x) => x !== c) : [...prev, c]))
                }
              >
                {c}
              </button>
            ))}
          </div>
          <div className="row">
            <label>
              edit minutes{" "}
              <input
                className="input tabular"
                type="number"
                value={minutes}
                onChange={(e) => setMinutes(Number(e.target.value))}
              />
            </label>
            <input
              className="input"
              placeholder="note"
              value={note}
              onChange={(e) => setNote(e.target.value)}
              style={{ flex: 1 }}
            />
          </div>
          <div className="muted">
            space plays all three · 1–4 verdict · last ledger:{" "}
            {ledgerRows[0]?.editor_verdict ?? "none"}
          </div>
        </div>
      )}
    </div>
  );
}

function Player(props: {
  ratio: string;
  src: string;
  width: number;
  height: number;
  register: (el: HTMLVideoElement | null) => void;
}) {
  return (
    <div>
      <div className="muted" style={{ marginBottom: 8 }}>
        {props.ratio}
      </div>
      <video
        ref={props.register}
        width={props.width}
        height={props.height}
        src={props.src}
        controls
        playsInline
      />
    </div>
  );
}

function PlanBeats({ jobId, ratio }: { jobId: string; ratio: string }) {
  const [beats, setBeats] = useState<{ role: string; treatment: string; evidence_ids: string[] }[]>([]);
  useEffect(() => {
    fetch(`/api/v1/jobs/${jobId}/timeline/${encodeURIComponent(ratio)}`)
      .then((r) => r.json())
      .then(async () => {
        const job = await fetch(`/api/v1/jobs/${jobId}`).then((r) => r.json());
        void job;
      })
      .catch(() => undefined);
    fetch(`/api/v1/jobs/${jobId}`)
      .then((r) => r.json())
      .then(async (j) => {
        const rec = await fetch(`/api/v1/recipes/${j.job.recipe_id}`).then((r) => r.json());
        void rec;
      });
  }, [jobId, ratio]);
  useEffect(() => {
    fetch(`/api/v1/jobs/${jobId}/timeline/${encodeURIComponent(ratio)}`)
      .then((r) => (r.ok ? r.json() : null))
      .then((j) => {
        if (!j) return;
        setBeats(
          (j.timeline.layers as { id: string; type: string }[])
            .filter((l) => l.id.startsWith("beat_"))
            .map((l) => ({ role: l.id, treatment: l.type, evidence_ids: [] })),
        );
      });
  }, [jobId, ratio]);
  return (
    <div className="grid" style={{ marginTop: 12 }}>
      {beats.map((b) => (
        <div key={b.role} className="muted">
          {b.role} · {b.treatment}
        </div>
      ))}
    </div>
  );
}

function TimelineInspector({ timelines }: { timelines: Record<string, Timeline> }) {
  const [ratio, setRatio] = useState<string>("9:16");
  const [t, setT] = useState(0);
  const tl = timelines[ratio];
  if (!tl) return <div className="muted">Timeline not ready.</div>;
  const dur = tl.duration_ms;
  const safe =
    ratio === "9:16"
      ? { top: 220, bottom: 346, side: 60 }
      : ratio === "1:1"
        ? { top: 60, bottom: 160, side: 60 }
        : { top: 54, bottom: 108, side: 96 };
  const scale = ratio === "9:16" ? 0.22 : ratio === "1:1" ? 0.32 : 0.22;
  return (
    <div className="grid" style={{ gridTemplateColumns: "1fr 320px", gap: 16 }}>
      <div className="panel">
        <div className="row">
          {(["9:16", "16:9", "1:1"] as const).map((r) => (
            <button key={r} className={`chip ${ratio === r ? "on" : ""}`} onClick={() => setRatio(r)}>
              {r}
            </button>
          ))}
        </div>
        <div style={{ marginTop: 16, position: "relative", width: tl.width * scale, height: tl.height * scale, background: "#000" }}>
          <div
            style={{
              position: "absolute",
              inset: `${safe.top * scale}px ${safe.side * scale}px ${safe.bottom * scale}px ${safe.side * scale}px`,
              border: "1px solid #3d7eff",
              pointerEvents: "none",
            }}
          />
          {tl.layers
            .filter((l) => l.start_ms <= t && l.end_ms >= t)
            .map((l) => (
              <div
                key={l.id}
                style={{
                  position: "absolute",
                  left: l.dest.x * scale,
                  top: l.dest.y * scale,
                  width: l.dest.w * scale,
                  height: l.dest.h * scale,
                  border: "1px solid #e8e8ea",
                  fontSize: 10,
                  color: "#e8e8ea",
                }}
              >
                {l.id}
              </div>
            ))}
        </div>
        <input
          type="range"
          min={0}
          max={dur}
          value={t}
          onChange={(e) => setT(Number(e.target.value))}
          style={{ width: "100%", marginTop: 12 }}
        />
        <div className="tabular muted">{t} ms</div>
        <div style={{ marginTop: 16 }}>
          {tl.layers.map((l) => (
            <div key={l.id} style={{ display: "grid", gridTemplateColumns: "120px 1fr", gap: 8, marginBottom: 6 }}>
              <div className="muted">{l.id}</div>
              <div style={{ position: "relative", height: 12, background: "#121214" }}>
                <div
                  style={{
                    position: "absolute",
                    left: `${(l.start_ms / dur) * 100}%`,
                    width: `${((l.end_ms - l.start_ms) / dur) * 100}%`,
                    top: 0,
                    bottom: 0,
                    background: l.type === "cta_card" ? "#3d7eff" : "#4a4a52",
                  }}
                />
              </div>
            </div>
          ))}
        </div>
      </div>
      <pre className="panel" style={{ overflow: "auto", maxHeight: 640, fontSize: 11 }}>
        {JSON.stringify(tl, null, 2)}
      </pre>
    </div>
  );
}
