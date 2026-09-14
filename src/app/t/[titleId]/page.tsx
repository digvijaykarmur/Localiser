"use client";

import { useEffect, useMemo, useState } from "react";
import type { Angle, EvidenceUnit, TitleIntelligence } from "@/domain";

const SHOTS = ["ECU", "CU", "MCU", "MS", "TWO_SHOT", "GROUP", "WIDE", "INSERT", "ACTION"] as const;

export default function TitleWorkspace({ params }: { params: { titleId: string } }) {
  const [intel, setIntel] = useState<TitleIntelligence | null>(null);
  const [titleName, setTitleName] = useState(params.titleId);
  const [tab, setTab] = useState<"evidence" | "angles" | "compose">("evidence");
  const [shot, setShot] = useState<string>("");
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);

  async function load() {
    const r = await fetch(`/api/v1/titles/${params.titleId}/intelligence`);
    if (r.ok) {
      const j = await r.json();
      setIntel(j.intelligence);
    }
  }

  useEffect(() => {
    void load();
    fetch(`/api/v1/titles?id=${encodeURIComponent(params.titleId)}`)
      .then((r) => r.json())
      .then((j) => {
        const t = j.titles?.[0];
        if (t?.name) setTitleName(t.name);
      })
      .catch(() => undefined);
  }, [params.titleId]);

  async function build() {
    setBusy(true);
    setMsg(null);
    const r = await fetch(`/api/v1/titles/${params.titleId}/intelligence`, { method: "POST" });
    const j = await r.json();
    setBusy(false);
    if (!r.ok) return setMsg(j.error);
    setIntel(j.intelligence);
  }

  const evidence = useMemo(() => {
    const list = intel?.evidence ?? [];
    return shot ? list.filter((e) => e.shot_type === shot) : list;
  }, [intel, shot]);

  return (
    <div className="grid" style={{ gap: 16 }}>
      <div className="row" style={{ justifyContent: "space-between" }}>
        <h1>{titleName}</h1>
        <button className="btn primary" disabled={busy} onClick={build}>
          {busy ? "Building…" : "Build intelligence"}
        </button>
      </div>
      {msg && <div className="muted">{msg}</div>}
      <div className="row">
        {(["evidence", "angles", "compose"] as const).map((t) => (
          <button key={t} className={`chip ${tab === t ? "on" : ""}`} onClick={() => setTab(t)}>
            {t}
          </button>
        ))}
      </div>
      {tab === "evidence" && (
        <>
          <div className="row" style={{ flexWrap: "wrap" }}>
            <button className={`chip ${shot === "" ? "on" : ""}`} onClick={() => setShot("")}>
              all
            </button>
            {SHOTS.map((s) => (
              <button key={s} className={`chip ${shot === s ? "on" : ""}`} onClick={() => setShot(s)}>
                {s}
              </button>
            ))}
          </div>
          <div className="grid" style={{ gridTemplateColumns: "repeat(auto-fill, minmax(220px, 1fr))" }}>
            {evidence.map((e) => (
              <EvidenceCard key={e.id} unit={e} />
            ))}
          </div>
        </>
      )}
      {tab === "angles" && (
        <div className="grid">
          {(intel?.angles ?? []).map((a) => (
            <AngleCard key={a.id} angle={a} evidence={intel?.evidence ?? []} />
          ))}
        </div>
      )}
      {tab === "compose" && intel && <ComposeForm titleId={params.titleId} intel={intel} />}
    </div>
  );
}

function EvidenceCard({ unit }: { unit: EvidenceUnit }) {
  return (
    <div className={`panel shot-${unit.shot_type}`}>
      <div className={`thumb ${unit.croppable_916 ? "" : "uncroppable"}`}>
        <div className="ph">{unit.shot_type}</div>
      </div>
      <div className="muted tabular" style={{ marginTop: 8 }}>
        {unit.start_ms}–{unit.end_ms} · i{unit.intensity}
      </div>
      <div className="devanagari" style={{ fontSize: 16, marginTop: 6 }}>
        {unit.dialogue_native ?? unit.description}
      </div>
      <div className="muted" style={{ marginTop: 6 }}>
        1:1 {unit.croppable_11 ? "crop" : "compose"} · 9:16 {unit.croppable_916 ? "crop" : "compose"}
      </div>
    </div>
  );
}

function AngleCard({ angle, evidence }: { angle: Angle; evidence: EvidenceUnit[] }) {
  const units = evidence.filter((e) => angle.evidence_ids.includes(e.id));
  return (
    <div className="panel">
      <div className="muted">{angle.kind}</div>
      <h2 style={{ marginTop: 6 }}>{angle.claim}</h2>
      <div className="row" style={{ marginTop: 10, flexWrap: "wrap" }}>
        {units.map((u) => (
          <span key={u.id} className={`chip shot-${u.shot_type}`}>
            {u.shot_type}
          </span>
        ))}
      </div>
    </div>
  );
}

function ComposeForm({ titleId, intel }: { titleId: string; intel: TitleIntelligence }) {
  const [angleId, setAngleId] = useState(intel.angles[0]?.id ?? "");
  const [format, setFormat] = useState<"SC" | "CP" | "SU">("SC");
  const [duration, setDuration] = useState<20 | 30 | 45 | 60>(20);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [dialect, setDialect] = useState("hry");

  useEffect(() => {
    fetch(`/api/v1/titles?id=${encodeURIComponent(titleId)}`)
      .then((r) => r.json())
      .then((j) => {
        const t = (j.titles ?? []).find((x: { id: string }) => x.id === titleId);
        if (t?.dialect) setDialect(t.dialect);
      })
      .catch(() => undefined);
  }, [titleId]);

  async function submit() {
    if (!angleId) {
      setErr("Build intelligence first so an angle exists.");
      return;
    }
    setErr(null);
    setBusy(true);
    try {
      const recipeRes = await fetch("/api/v1/recipes", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          title_id: titleId,
          angle_id: angleId,
          format,
          dialect,
          duration_s: duration,
          ratios: ["16:9", "9:16", "1:1"],
          source_window: format === "SC" ? { start_ms: 5000, end_ms: 25000 } : null,
          persona_id: format === "SU" ? "persona_local" : null,
          music_brief: format === "SC" ? null : "sparse rural percussion, no vocal",
          cta_variant: "default",
          created_by: "local-operator",
        }),
      });
      const recipe = await recipeRes.json();
      if (!recipeRes.ok) {
        setErr(recipe.error);
        return;
      }
      const jobRes = await fetch("/api/v1/jobs", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ recipe_id: recipe.recipe.id }),
      });
      const job = await jobRes.json();
      if (!jobRes.ok) {
        setErr(job.error);
        return;
      }
      window.location.href = `/j/${job.job_id}`;
    } finally {
      setBusy(false);
    }
  }

  const formatHelp =
    format === "SC"
      ? "Single Clip — source audio, burned captions, fastest (good first promo)."
      : format === "CP"
        ? "Caption Promo — dialect VO + music + caption cards (uses ElevenLabs when live)."
        : "Split UGC — presenter + source stack (Veo is still a local stand-in).";

  return (
    <div className="panel grid" style={{ gap: 12, maxWidth: 560 }}>
      {!intel.angles.length && (
        <div className="muted">No angles yet. Click Build intelligence first.</div>
      )}
      <label>
        Angle
        <select className="input" style={{ width: "100%", marginTop: 6 }} value={angleId} onChange={(e) => setAngleId(e.target.value)}>
          {intel.angles.map((a) => (
            <option key={a.id} value={a.id}>
              {a.claim}
            </option>
          ))}
        </select>
      </label>
      <label>
        Format
        <select className="input" style={{ width: "100%", marginTop: 6 }} value={format} onChange={(e) => setFormat(e.target.value as "SC" | "CP" | "SU")}>
          <option value="SC">Single Clip</option>
          <option value="CP">Caption Promo</option>
          <option value="SU">Split UGC</option>
        </select>
      </label>
      <div className="muted">{formatHelp}</div>
      <label>
        Duration
        <select className="input" style={{ width: "100%", marginTop: 6 }} value={duration} onChange={(e) => setDuration(Number(e.target.value) as 20 | 30 | 45 | 60)}>
          <option value={20}>20s</option>
          <option value={30}>30s</option>
          <option value={45}>45s</option>
          <option value={60}>60s</option>
        </select>
      </label>
      <button className="btn primary" disabled={busy || !intel.angles.length} onClick={() => void submit()}>
        {busy ? "Starting…" : "Lock recipe and run"}
      </button>
      {err && <div className="muted">{err}</div>}
    </div>
  );
}
