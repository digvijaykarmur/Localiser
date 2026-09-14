"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import type { Title } from "@/domain";

const DIALECTS = ["hry", "raj", "bho", "guj", "mar", "ben"] as const;

export default function LibraryPage() {
  const [dialect, setDialect] = useState<string>("hry");
  const [titles, setTitles] = useState<Title[]>([]);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    setErr(null);
    fetch(`/api/v1/titles?dialect=${dialect}`)
      .then(async (r) => {
        const j = await r.json();
        if (!r.ok) throw new Error(j.error ?? r.statusText);
        setTitles(j.titles);
      })
      .catch((e) => setErr(String(e.message)));
  }, [dialect]);

  return (
    <div className="grid" style={{ gap: 16 }}>
      <div className="row" style={{ justifyContent: "space-between" }}>
        <h1>Library</h1>
        <div className="row">
          {DIALECTS.map((d) => (
            <button
              key={d}
              className={`chip ${dialect === d ? "on" : ""}`}
              onClick={() => setDialect(d)}
            >
              {d}
            </button>
          ))}
        </div>
      </div>
      {err && <div className="muted">{err}</div>}
      <div className="grid" style={{ gridTemplateColumns: "repeat(auto-fill, minmax(280px, 1fr))" }}>
        {titles.map((t) => (
          <Link key={t.id} href={`/t/${t.id}`} className="panel">
            <div className="muted tabular">{t.dialect.toUpperCase()}</div>
            <h2 style={{ marginTop: 8 }}>{t.name}</h2>
            <div className="devanagari" style={{ marginTop: 6 }}>
              {t.name_native}
            </div>
            <p className="muted" style={{ marginTop: 12 }}>
              {t.synopsis}
            </p>
          </Link>
        ))}
        {!titles.length && !err && <div className="muted">No titles for this dialect.</div>}
      </div>
    </div>
  );
}
