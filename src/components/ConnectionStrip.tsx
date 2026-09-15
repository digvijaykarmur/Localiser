"use client";

import { useState, useTransition } from "react";
import type { ChipState } from "@/providers/ports-types";

const DOT: Record<ChipState["state"], string> = { ok: "bg-approved", snapshot: "bg-amber", error: "bg-rejected" };

/** Four chips — Antryami, ClickHouse, Vertex, ElevenLabs — green, amber (snapshot) or red with the exact error (§5). */
export function ConnectionStrip({ initial, check }: { initial: ChipState[] | null; check: () => Promise<ChipState[]> }) {
  const [chips, setChips] = useState<ChipState[] | null>(initial);
  const [pending, start] = useTransition();
  return (
    <div className="flex items-center gap-2 flex-wrap">
      {(chips ?? [{ name: "Antryami" }, { name: "ClickHouse" }, { name: "Vertex" }, { name: "ElevenLabs" }].map((c) => ({ ...c, state: "snapshot" as const, detail: "not checked yet" }))).map((c) => (
        <span key={c.name} className="chip" title={c.detail}>
          <span className={`w-2 h-2 rounded-full ${chips ? DOT[c.state] : "bg-faint"}`} />
          {c.name}
          {chips && c.state !== "ok" && <span className="text-faint max-w-[260px] truncate">· {c.detail}</span>}
        </span>
      ))}
      <button className="btn btn-sm" disabled={pending} onClick={() => start(async () => setChips(await check()))}>
        {pending ? "Checking…" : "Check connections"}
      </button>
    </div>
  );
}
