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
      <div className="panel">
        <div className="muted">Make a promo from live catalogue</div>
        <ol style={{ margin: "8px 0 0", paddingLeft: 18, lineHeight: 1.6 }}>
          <li>
            Open a live title (Haryanvi is <strong>har</strong> in Antaryami, shown here as{" "}
            <strong>hry</strong>). Snapshot stand-ins are only used if the API key is missing.
          </li>
          <li>
            Click <strong>Build intelligence</strong> — scenes/shots come from Antaryami, scene
            timings fall back to ClickHouse.
          </li>
          <li>
            Open the <strong>compose</strong> tab, pick format (SC is fastest), duration, then{" "}
            <strong>Lock recipe and run</strong>.
          </li>
          <li>Wait on the job page. Preview 16:9 / 9:16 / 1:1, download, then review.</li>
        </ol>
        <div className="muted" style={{ marginTop: 8 }}>
          CLI:{" "}
          <span className="tabular">pnpm promo -- --title jalebi-har-s01e03 --format SC</span>
        </div>
        <div className="muted" style={{ marginTop: 8 }}>
          Episode MP4s on CMS S3 are private (403). Intelligence still uses real scenes, shots,
          and dialogue; picture may be a poster stand-in until a signed proxy exists.
        </div>
      </div>
      <div className="grid" style={{ gridTemplateColumns: "repeat(auto-fill, minmax(280px, 1fr))" }}>
        {titles.map((t) => (
          <Link key={t.id} href={`/t/${t.id}`} className="panel">
            {t.artwork_url && (
              <img
                src={t.artwork_url}
                alt=""
                style={{ width: "100%", height: 140, objectFit: "cover", borderRadius: 6, marginBottom: 10 }}
              />
            )}
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
