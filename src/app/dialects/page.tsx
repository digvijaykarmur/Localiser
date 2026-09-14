"use client";

import { useEffect, useState } from "react";
import type { DialectPack } from "@/domain";

export default function DialectsPage() {
  const [packs, setPacks] = useState<DialectPack[]>([]);
  const [code, setCode] = useState("hry");
  useEffect(() => {
    fetch("/api/v1/dialects")
      .then((r) => r.json())
      .then((j) => {
        setPacks(j.dialects ?? []);
        if (j.dialects?.[0]) setCode(j.dialects[0].code);
      });
  }, []);
  const pack = packs.find((p) => p.code === code);
  return (
    <div className="grid" style={{ gap: 16 }}>
      <h1>Dialect packs</h1>
      <div className="row">
        {packs.map((p) => (
          <button key={p.code} className={`chip ${code === p.code ? "on" : ""}`} onClick={() => setCode(p.code)}>
            {p.name}
          </button>
        ))}
      </div>
      {pack && (
        <div className="grid" style={{ gridTemplateColumns: "1fr 1fr", gap: 16 }}>
          <div className="panel grid" style={{ gap: 10 }}>
            <label>
              words / second
              <input className="input" readOnly value={pack.rhythm.words_per_second} />
            </label>
            <label>
              caption max words
              <input className="input" readOnly value={pack.rhythm.caption_max_words} />
            </label>
            <label>
              register
              <textarea className="input" readOnly value={pack.register} rows={4} />
            </label>
            <label>
              default CTA
              <div className="devanagari">{pack.cta_templates.default}</div>
            </label>
            <div className="muted">
              Packs are versioned in git. No write API in v1 — edit the JSON in{" "}
              <code>src/data/dialects</code>.
            </div>
          </div>
          <pre className="panel" style={{ overflow: "auto", maxHeight: 640 }}>
            {JSON.stringify(pack, null, 2)}
          </pre>
        </div>
      )}
    </div>
  );
}
