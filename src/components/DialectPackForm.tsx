"use client";

import { useRouter } from "next/navigation";
import { useMemo, useRef, useState } from "react";
import { DialectPack as DialectPackSchema, packCompleteness, type DialectPack } from "@/domain/dialect";
import { DURATIONS } from "@/domain/primitives";
import { voiceSampleAction } from "@/app/actions";
import { ErrorBox } from "./ErrorBox";
import { api, inr, type ApiError } from "./lib/api";

type Voice = { voice_id: string; name: string; labels: Record<string, string> };
type Hist = { version: string; saved_by: string; created_at: string };

/** J1 — form over the JSON. Left: fields. Right: live JSON, read-only (§6). Save writes the file and a dialect_versions row. */
export function DialectPackForm({ initial, voices, history, ctaDurationS }: { initial: DialectPack; voices: Voice[]; history: Hist[]; ctaDurationS: number }) {
  const router = useRouter();
  const [pack, setPack] = useState<DialectPack>(initial);
  const [error, setError] = useState<ApiError | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [sample, setSample] = useState<{ text: string; cost_inr: number } | null>(null);
  const [dirtyJson, setDirtyJson] = useState<string | null>(null);
  const audioRef = useRef<HTMLAudioElement>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  const json = useMemo(() => JSON.stringify(pack, null, 2), [pack]);
  const parsed = useMemo(() => DialectPackSchema.safeParse(pack), [pack]);
  const issues = parsed.success ? [] : parsed.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`);
  const comp = packCompleteness(pack);
  const changed = json !== JSON.stringify(initial, null, 2);

  const set = <K extends keyof DialectPack>(k: K, v: DialectPack[K]) => setPack((p) => ({ ...p, [k]: v }));
  const setRhythm = (k: keyof DialectPack["rhythm"], v: number) => set("rhythm", { ...pack.rhythm, [k]: v });
  const setVoiceSetting = (k: keyof DialectPack["voice"]["settings"], v: number) => set("voice", { ...pack.voice, settings: { ...pack.voice.settings, [k]: v } });
  const setTypo = (k: keyof DialectPack["typography"], v: number | string) => set("typography", { ...pack.typography, [k]: v });

  const save = async () => {
    setBusy("save");
    setError(null);
    try {
      await api(`/api/v1/dialects/${pack.code}`, { method: "PUT", json: { pack, saved_by: "channel_lead" } });
      router.refresh();
    } catch (e) {
      setError((e as { error?: ApiError }).error ?? { code: "ERROR", message: String(e) });
    } finally {
      setBusy(null);
    }
  };

  const playSample = async (voiceId: string) => {
    setBusy(`sample:${voiceId}`);
    setError(null);
    try {
      const r = await voiceSampleAction(pack, voiceId);
      setSample({ text: r.text, cost_inr: r.cost_inr });
      if (audioRef.current) {
        audioRef.current.src = `data:audio/mpeg;base64,${r.mp3_base64}`;
        await audioRef.current.play().catch(() => undefined);
      }
    } catch (e) {
      setError({ code: "TTS", message: e instanceof Error ? e.message : String(e), recovery: "Check the ElevenLabs chip on the Library page." });
    } finally {
      setBusy(null);
    }
  };

  const importCsv = async (file: File) => {
    const text = await file.text();
    const replace = { ...pack.lexicon.replace };
    for (const line of text.split(/\r?\n/)) {
      const [k, v] = line.split(",").map((s) => s?.trim().replace(/^"|"$/g, ""));
      if (k && v) replace[k] = v;
    }
    set("lexicon", { ...pack.lexicon, replace });
  };

  const applyJson = () => {
    if (dirtyJson === null) return;
    try {
      setPack(DialectPackSchema.parse(JSON.parse(dirtyJson)));
      setDirtyJson(null);
      setError(null);
    } catch (e) {
      setError({ code: "VALIDATION", message: e instanceof Error ? e.message : String(e) });
    }
  };

  const words = Math.floor((30 - ctaDurationS) * pack.rhythm.words_per_second);

  return (
    <div className="grid grid-cols-1 xl:grid-cols-[1fr_440px] gap-4">
      <div className="space-y-4">
        <header className="flex items-start justify-between gap-4 flex-wrap">
          <div>
            <h1 className="text-lg font-medium">
              {pack.name} <span className="text-muted num text-[13px]">{pack.version}</span>
            </h1>
            <div className="text-muted text-[13px]">
              voice {comp.voice ? "✓" : "✗"} · rhythm {comp.rhythm ? "✓" : "✗"} · lexicon {comp.lexicon_entries} entries · taboo {comp.taboo} · CTA {comp.cta_variants} variant{comp.cta_variants === 1 ? "" : "s"} · {pack.script} · {pack.channel_id}
            </div>
          </div>
          <button className="btn btn-primary" disabled={!changed || issues.length > 0 || busy !== null} onClick={save} title="Writes src/data/dialects/{code}.json and a dialect_versions row; version bumps">
            {busy === "save" ? "Saving…" : `Save as ${pack.version.replace(/\.v(\d+)$/, (_, n) => `.v${Number(n) + 1}`)}`}
          </button>
        </header>
        {issues.length > 0 && <ErrorBox error={{ code: "VALIDATION", message: "Pack does not validate yet.", detail: { problems: issues } }} />}
        <ErrorBox error={error} />

        <Section title="Voice" hint="The only way to judge a voice is to hear it say this pack's CTA.">
          <div className="grid grid-cols-2 md:grid-cols-4 gap-2">
            <Field label="model">
              <input className="input w-full" value={pack.voice.model} onChange={(e) => set("voice", { ...pack.voice, model: e.target.value })} />
            </Field>
            <Field label="language_code">
              <input className="input w-full" value={pack.voice.language_code} onChange={(e) => set("voice", { ...pack.voice, language_code: e.target.value })} />
            </Field>
            {(["stability", "similarity_boost", "style", "speed"] as const).map((k) => (
              <Field key={k} label={`${k} ${pack.voice.settings[k]}`}>
                <input type="range" min={k === "speed" ? 0.5 : 0} max={k === "speed" ? 1.5 : 1} step={0.05} value={pack.voice.settings[k]} onChange={(e) => setVoiceSetting(k, Number(e.target.value))} className="w-full accent-[#3D7EFF]" />
              </Field>
            ))}
          </div>
          <div className="mt-2 space-y-1 max-h-[260px] overflow-auto">
            {voices.length === 0 && <div className="text-faint text-[12px]">No voices listed — the ElevenLabs chip is red or in snapshot mode. You can still type a voice_id.</div>}
            {voices.map((v) => {
              const on = v.voice_id === pack.voice.voice_id;
              return (
                <div key={v.voice_id} className={`flex items-center gap-2 p-2 rounded border ${on ? "border-accent" : "border-hairline"}`}>
                  <button className={`btn btn-sm ${on ? "btn-primary" : ""}`} onClick={() => set("voice", { ...pack.voice, voice_id: v.voice_id })}>
                    {on ? "selected" : "use"}
                  </button>
                  <span className="text-ink">{v.name}</span>
                  <span className="text-faint text-[12px] truncate">{Object.values(v.labels).join(" · ")}</span>
                  <button className="btn btn-sm ml-auto" disabled={busy !== null} onClick={() => playSample(v.voice_id)}>
                    {busy === `sample:${v.voice_id}` ? "…" : "▶ CTA sample"}
                  </button>
                </div>
              );
            })}
          </div>
          <Field label="voice_id">
            <input className="input w-full num" value={pack.voice.voice_id} onChange={(e) => set("voice", { ...pack.voice, voice_id: e.target.value })} />
          </Field>
          <audio ref={audioRef} controls className="w-full h-8 mt-2" />
          {sample && (
            <div className="text-[12px] text-muted mt-1">
              <span className="native text-ink">{sample.text}</span> · {inr(sample.cost_inr)}
            </div>
          )}
        </Section>

        <Section title="Rhythm" hint={`At ${pack.rhythm.words_per_second} wps, a 30s promo with a ${ctaDurationS}s CTA allows ${words} words.`}>
          <div className="grid grid-cols-2 md:grid-cols-3 gap-2">
            {(["words_per_second", "sentence_max_words", "caption_max_words", "beat_min_ms", "beat_max_ms", "hook_max_ms"] as const).map((k) => (
              <Field key={k} label={k}>
                <input className="input w-full num" inputMode="decimal" value={pack.rhythm[k]} onChange={(e) => setRhythm(k, Number(e.target.value))} step={k === "words_per_second" ? 0.1 : 1} type="number" />
              </Field>
            ))}
          </div>
          <div className="mt-2 flex gap-3 flex-wrap text-[12px] text-muted num">
            {DURATIONS.map((d) => (
              <span key={d}>
                {d}s → <span className="text-ink">{Math.floor((d - ctaDurationS) * pack.rhythm.words_per_second)}</span> words
              </span>
            ))}
          </div>
        </Section>

        <Section title="Lexicon" hint="replace is applied mechanically after scripting; avoid triggers a regeneration.">
          <div className="flex items-center gap-2 mb-2">
            <button className="btn btn-sm" onClick={() => set("lexicon", { ...pack.lexicon, replace: { ...pack.lexicon.replace, "": "" } })}>
              + row
            </button>
            <button className="btn btn-sm" onClick={() => fileRef.current?.click()}>
              Import CSV (from,to)
            </button>
            <input ref={fileRef} type="file" accept=".csv,text/csv" className="hidden" onChange={(e) => e.target.files?.[0] && importCsv(e.target.files[0])} />
          </div>
          <div className="space-y-1">
            {Object.entries(pack.lexicon.replace).map(([k, v], i) => (
              <div key={i} className="flex gap-1">
                <input
                  className="input native flex-1"
                  value={k}
                  placeholder="standard"
                  onChange={(e) => {
                    const entries = Object.entries(pack.lexicon.replace);
                    entries[i] = [e.target.value, v];
                    set("lexicon", { ...pack.lexicon, replace: Object.fromEntries(entries) });
                  }}
                />
                <span className="text-faint self-center">→</span>
                <input className="input native flex-1" value={v} placeholder="dialect" onChange={(e) => set("lexicon", { ...pack.lexicon, replace: { ...pack.lexicon.replace, [k]: e.target.value } })} />
                <button
                  className="btn btn-sm text-rejected"
                  onClick={() => {
                    const r = { ...pack.lexicon.replace };
                    delete r[k];
                    set("lexicon", { ...pack.lexicon, replace: r });
                  }}
                >
                  ×
                </button>
              </div>
            ))}
          </div>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-2 mt-2">
            <Field label="prefer (comma-separated)">
              <input className="input w-full native" value={pack.lexicon.prefer.join(", ")} onChange={(e) => set("lexicon", { ...pack.lexicon, prefer: splitList(e.target.value) })} />
            </Field>
            <Field label="avoid (comma-separated)">
              <input className="input w-full native" value={pack.lexicon.avoid.join(", ")} onChange={(e) => set("lexicon", { ...pack.lexicon, avoid: splitList(e.target.value) })} />
            </Field>
          </div>
        </Section>

        <Section title="Taboo">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-2">
            <Field label="words">
              <input className="input w-full native" value={pack.taboo.words.join(", ")} onChange={(e) => set("taboo", { ...pack.taboo, words: splitList(e.target.value) })} />
            </Field>
            <Field label="themes">
              <input className="input w-full" value={pack.taboo.themes.join(", ")} onChange={(e) => set("taboo", { ...pack.taboo, themes: splitList(e.target.value) })} />
            </Field>
          </div>
        </Section>

        <Section title="CTA templates" hint="The model never writes the CTA. {title} is substituted by code.">
          {Object.entries(pack.cta_templates).map(([k, v]) => (
            <div key={k} className="flex gap-1 mb-1">
              <input className="input w-28 num" value={k} readOnly />
              <input className="input native flex-1" value={v} onChange={(e) => set("cta_templates", { ...pack.cta_templates, [k]: e.target.value })} />
              {k !== "default" && (
                <button
                  className="btn btn-sm text-rejected"
                  onClick={() => {
                    const t = { ...pack.cta_templates };
                    delete t[k];
                    set("cta_templates", t);
                  }}
                >
                  ×
                </button>
              )}
            </div>
          ))}
          <button
            className="btn btn-sm"
            onClick={() => {
              const name = window.prompt("Variant name (e.g. urgent)");
              if (name && !(name in pack.cta_templates)) set("cta_templates", { ...pack.cta_templates, [name]: "{title} — STAGE" });
            }}
          >
            + variant
          </button>
          <div className="native-lg mt-2 text-ink">{(pack.cta_templates.default ?? "").split("{title}").join(pack.name)}</div>
        </Section>

        <Section title="Typography">
          <div className="grid grid-cols-2 md:grid-cols-5 gap-2">
            <Field label="caption_font">
              <input className="input w-full" value={pack.typography.caption_font} onChange={(e) => setTypo("caption_font", e.target.value)} />
            </Field>
            {(["caption_size_916", "caption_size_11", "caption_size_169", "line_height"] as const).map((k) => (
              <Field key={k} label={k}>
                <input type="number" step={k === "line_height" ? 0.01 : 1} className="input w-full num" value={pack.typography[k]} onChange={(e) => setTypo(k, Number(e.target.value))} />
              </Field>
            ))}
          </div>
        </Section>

        <Section title="Register">
          <textarea className="input w-full h-16 py-1" value={pack.register} onChange={(e) => set("register", e.target.value)} />
        </Section>
      </div>

      <aside className="space-y-3">
        <div className="panel p-2">
          <div className="flex items-center justify-between px-1 mb-1">
            <span className="text-[12px] text-muted">{dirtyJson === null ? "live JSON" : "edited JSON"}</span>
            {dirtyJson !== null ? (
              <div className="flex gap-1">
                <button className="btn btn-sm" onClick={() => setDirtyJson(null)}>
                  discard
                </button>
                <button className="btn btn-sm btn-primary" onClick={applyJson}>
                  apply
                </button>
              </div>
            ) : (
              <span className="text-[11px] text-faint">edit to override the form</span>
            )}
          </div>
          <textarea className="w-full h-[560px] bg-surface text-muted text-[11px] font-mono p-2 rounded border border-hairline focus:outline-none focus:border-accent" value={dirtyJson ?? json} onChange={(e) => setDirtyJson(e.target.value)} spellCheck={false} />
        </div>
        <div className="panel p-3">
          <div className="text-[12px] text-muted mb-1">Versions</div>
          {history.length === 0 && <div className="text-faint text-[12px]">Not yet saved through the UI; on-disk version is {initial.version}.</div>}
          {history.map((h) => (
            <div key={h.version} className="flex justify-between text-[12px]">
              <span className="num text-ink">{h.version}</span>
              <span className="text-muted">
                {h.saved_by} · {new Date(h.created_at).toLocaleString()}
              </span>
            </div>
          ))}
        </div>
      </aside>
    </div>
  );
}

function Section({ title, hint, children }: { title: string; hint?: string; children: React.ReactNode }) {
  return (
    <section className="panel p-3">
      <div className="flex items-baseline justify-between mb-2">
        <h2 className="font-medium">{title}</h2>
        {hint && <span className="text-[12px] text-muted">{hint}</span>}
      </div>
      {children}
    </section>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="block text-[12px] text-muted">
      {label}
      <div className="mt-0.5">{children}</div>
    </label>
  );
}

const splitList = (s: string) =>
  s
    .split(",")
    .map((x) => x.trim())
    .filter(Boolean);
