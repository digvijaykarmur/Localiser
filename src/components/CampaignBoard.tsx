"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useMemo, useState } from "react";
import type { Campaign, SlotStatus } from "@/domain/campaign";
import type { Preset } from "@/domain/recipe";
import { DIALECT_NAMES, FORMAT_NAMES, type DialectCode, type FormatCode } from "@/domain/primitives";
import { ErrorBox } from "./ErrorBox";
import { SlotCell, type SlotView } from "./SlotCell";
import { api, inr, type ApiError } from "./lib/api";

export interface CampaignView extends Campaign {
  slots: SlotView[];
  counts: Record<SlotStatus, number>;
  spend_inr: number;
}
type TitleOpt = { id: string; name: string; name_native: string; dialect: DialectCode; intelligence_built_at: string | null };
type FillPreview = { items: { slot_id: string; date: string; title: { id: string; name: string }; angle: { id: string; claim: string }; estimate_inr: number }[]; total_estimate_inr: number; ok: boolean; problems: string[] };

const DAY = 86_400_000;
const fmtDay = (iso: string) => new Date(`${iso}T00:00:00Z`).toLocaleDateString(undefined, { weekday: "short", day: "numeric", timeZone: "UTC" });
const mondayOf = (d: Date) => {
  const x = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));
  const day = (x.getUTCDay() + 6) % 7;
  return new Date(x.getTime() - day * DAY).toISOString().slice(0, 10);
};

export function CampaignBoard({ campaigns, presets, titles, initialId }: { campaigns: CampaignView[]; presets: Preset[]; titles: TitleOpt[]; initialId: string | null }) {
  const router = useRouter();
  const [selectedId, setSelectedId] = useState<string | null>(initialId ?? campaigns[0]?.id ?? null);
  const campaign = campaigns.find((c) => c.id === selectedId) ?? null;
  const [error, setError] = useState<ApiError | null>(null);
  const [busy, setBusy] = useState<string | null>(null);

  // new campaign
  const [showNew, setShowNew] = useState(campaigns.length === 0);
  const [nName, setNName] = useState("");
  const [nChannel, setNChannel] = useState<DialectCode>("hry");
  const [nWeek, setNWeek] = useState(mondayOf(new Date()));
  const [nBudget, setNBudget] = useState("2000");

  // add slot
  const [addDate, setAddDate] = useState("");
  const [addFormat, setAddFormat] = useState<FormatCode>("CP");

  // batch fill
  const [picked, setPicked] = useState<string[]>([]);
  const [presetId, setPresetId] = useState(presets[0]?.id ?? "");
  const [titleFor, setTitleFor] = useState<Record<string, string>>({});
  const [preview, setPreview] = useState<FillPreview | null>(null);

  const days = useMemo(() => {
    if (!campaign) return [];
    const start = new Date(`${campaign.week_start}T00:00:00Z`).getTime();
    const dates = new Set<string>();
    for (let i = 0; i < 7; i++) dates.add(new Date(start + i * DAY).toISOString().slice(0, 10));
    for (const s of campaign.slots) dates.add(s.date);
    return [...dates].sort();
  }, [campaign]);

  const run = async <T,>(label: string, fn: () => Promise<T>, after?: (r: T) => void) => {
    setBusy(label);
    setError(null);
    try {
      const r = await fn();
      after?.(r);
    } catch (e) {
      setError((e as { error?: ApiError }).error ?? { code: "ERROR", message: String(e) });
    } finally {
      setBusy(null);
    }
  };

  const createCampaign = () =>
    run("new", () => api<CampaignView>("/api/v1/campaigns", { method: "POST", json: { name: nName, channel: nChannel, week_start: nWeek, budget_inr: Number(nBudget) } }), (c) => {
      setShowNew(false);
      setSelectedId(c.id);
      router.replace(`/campaigns?c=${c.id}`);
      router.refresh();
    });

  const addSlot = () => campaign && run("slot", () => api(`/api/v1/campaigns/${campaign.id}/slots`, { method: "POST", json: { slots: [{ date: addDate, intended_format: addFormat }] } }), () => router.refresh());

  const fills = () => picked.filter((id) => titleFor[id]).map((id) => ({ slot_id: id, title_id: titleFor[id]!, angle_id: null }));
  const previewFill = () => campaign && run("preview", () => api<FillPreview>(`/api/v1/campaigns/${campaign.id}/slots?preview=1`, { method: "POST", json: { fills: fills(), preset_id: presetId } }), setPreview);
  const confirmFill = () =>
    campaign &&
    preview &&
    run("fill", () => api(`/api/v1/campaigns/${campaign.id}/slots`, { method: "POST", json: { fills: fills(), preset_id: presetId, confirm_cost_inr: preview.total_estimate_inr } }), () => {
      setPicked([]);
      setTitleFor({});
      setPreview(null);
      router.refresh();
    });

  const toggle = (id: string) => {
    setPreview(null);
    setPicked((p) => (p.includes(id) ? p.filter((x) => x !== id) : [...p, id]));
  };
  const channelTitles = campaign ? titles.filter((t) => t.dialect === campaign.channel) : [];
  const fillable = new Set<SlotStatus>(["EMPTY", "PLANNED"]);

  return (
    <div className="grid grid-cols-1 xl:grid-cols-[260px_1fr] gap-4">
      <aside className="space-y-2">
        <div className="flex items-center justify-between">
          <h2 className="font-medium">Campaigns</h2>
          <button className="btn btn-sm" onClick={() => setShowNew((v) => !v)}>
            New
          </button>
        </div>
        {showNew && (
          <div className="panel p-3 space-y-2">
            <input className="input w-full" placeholder="October Week 2" value={nName} onChange={(e) => setNName(e.target.value)} />
            <select className="input w-full" value={nChannel} onChange={(e) => setNChannel(e.target.value as DialectCode)}>
              {(Object.keys(DIALECT_NAMES) as DialectCode[]).map((d) => (
                <option key={d} value={d}>
                  {DIALECT_NAMES[d]}
                </option>
              ))}
            </select>
            <label className="block text-[12px] text-muted">
              Week starting (Monday)
              <input type="date" className="input w-full num" value={nWeek} onChange={(e) => setNWeek(e.target.value)} />
            </label>
            <label className="block text-[12px] text-muted">
              Budget ₹
              <input className="input w-full num" inputMode="numeric" value={nBudget} onChange={(e) => setNBudget(e.target.value.replace(/\D/g, ""))} />
            </label>
            <button className="btn btn-primary w-full" disabled={!nName || !nBudget || busy !== null} onClick={createCampaign}>
              {busy === "new" ? "Creating…" : "Create campaign"}
            </button>
          </div>
        )}
        {campaigns.length === 0 && !showNew && <div className="panel p-4 text-muted text-[13px]">No campaigns yet. Create one for this week.</div>}
        {campaigns.map((c) => (
          <button key={c.id} className={`panel p-3 w-full text-left ${c.id === selectedId ? "border-accent" : "hover:border-muted"}`} onClick={() => setSelectedId(c.id)}>
            <div className="font-medium">{c.name}</div>
            <div className="text-[12px] text-muted">
              {DIALECT_NAMES[c.channel]} · wk {c.week_start}
            </div>
            <div className="text-[12px] text-muted num">
              {inr(c.spend_inr)} / {inr(c.budget_inr)}
            </div>
          </button>
        ))}
      </aside>

      <section className="space-y-4">
        {!campaign ? (
          <div className="panel p-10 text-center text-muted">Pick or create a campaign.</div>
        ) : (
          <>
            <header className="flex items-start justify-between gap-4 flex-wrap">
              <div>
                <h1 className="text-lg font-medium">
                  {campaign.name} · {DIALECT_NAMES[campaign.channel]}
                </h1>
                <div className="text-muted text-[13px]">
                  Planned {campaign.counts.PLANNED} · In production {campaign.counts.GENERATING} · Awaiting review {campaign.counts.AWAITING_REVIEW} · Approved {campaign.counts.APPROVED + campaign.counts.SCHEDULED} · Published {campaign.counts.PUBLISHED + campaign.counts.MEASURED} · Empty {campaign.counts.EMPTY}
                </div>
              </div>
              <div className="min-w-[220px]">
                <div className="flex justify-between text-[13px]">
                  <span className="text-muted">Spend</span>
                  <span className={`num ${campaign.spend_inr > campaign.budget_inr ? "text-rejected" : "text-ink"}`}>
                    {inr(campaign.spend_inr)} / {inr(campaign.budget_inr)}
                  </span>
                </div>
                <div className="h-1.5 mt-1 rounded bg-hairline overflow-hidden">
                  <div className={`h-full ${campaign.spend_inr > campaign.budget_inr ? "bg-rejected" : "bg-accent"}`} style={{ width: `${Math.min(100, (campaign.spend_inr / campaign.budget_inr) * 100)}%` }} />
                </div>
              </div>
            </header>

            <div className="grid gap-2" style={{ gridTemplateColumns: `repeat(${Math.max(1, days.length)}, minmax(0, 1fr))` }}>
              {days.map((d) => (
                <div key={d} className="space-y-2">
                  <div className="text-[12px] text-muted num">{fmtDay(d)}</div>
                  {campaign.slots
                    .filter((s) => s.date === d)
                    .map((s) => (
                      <SlotCell key={s.id} slot={s} selected={picked.includes(s.id)} selectable={fillable.has(s.status)} onToggle={toggle} />
                    ))}
                  {campaign.slots.filter((s) => s.date === d).length === 0 && <div className="border border-dashed border-hairline rounded-md min-h-[84px] text-faint text-[12px] flex items-center justify-center">—</div>}
                </div>
              ))}
            </div>

            <div className="flex items-end gap-2 flex-wrap">
              <label className="text-[12px] text-muted">
                Add slot
                <div className="flex gap-1">
                  <input type="date" className="input num" value={addDate} onChange={(e) => setAddDate(e.target.value)} />
                  <select className="input" value={addFormat} onChange={(e) => setAddFormat(e.target.value as FormatCode)}>
                    {(Object.keys(FORMAT_NAMES) as FormatCode[]).map((f) => (
                      <option key={f} value={f}>
                        {FORMAT_NAMES[f]}
                      </option>
                    ))}
                  </select>
                  <button className="btn" disabled={!addDate || busy !== null} onClick={addSlot}>
                    Add
                  </button>
                </div>
              </label>
            </div>

            <div className="panel p-3 space-y-3">
              <div className="flex items-baseline justify-between">
                <h2 className="font-medium">Batch fill</h2>
                <span className="text-[12px] text-muted">Select slots above, pick a preset, pick a title per slot, confirm the combined cost.</span>
              </div>
              {presets.length === 0 ? (
                <div className="text-[13px] text-muted">
                  Batch fill needs a preset (format + dialect + duration + ratios + CTA + music brief). Open a title’s{" "}
                  <Link className="text-accent" href={channelTitles[0] ? `/t/${channelTitles[0].id}?tab=compose` : "/"}>
                    Compose tab
                  </Link>{" "}
                  and click “Save as preset”.
                </div>
              ) : picked.length === 0 ? (
                <div className="text-faint text-[13px]">No slots selected.</div>
              ) : (
                <>
                  <div className="flex items-center gap-2">
                    <span className="text-muted text-[13px]">Preset</span>
                    <select className="input" value={presetId} onChange={(e) => setPresetId(e.target.value)}>
                      {presets.length === 0 && <option value="">No presets — save one from a title’s Compose tab</option>}
                      {presets.map((p) => (
                        <option key={p.id} value={p.id}>
                          {p.name} · {p.format} {p.duration_s}s {p.ratios.join(" ")}
                        </option>
                      ))}
                    </select>
                  </div>
                  <table className="w-full text-[13px]">
                    <tbody>
                      {picked.map((id) => {
                        const s = campaign.slots.find((x) => x.id === id)!;
                        const item = preview?.items.find((i) => i.slot_id === id);
                        return (
                          <tr key={id} className="border-t border-hairline">
                            <td className="py-1 pr-3 num text-muted">{fmtDay(s.date)}</td>
                            <td className="py-1 pr-3">{s.intended_format}</td>
                            <td className="py-1 pr-3">
                              <select
                                className="input w-full"
                                value={titleFor[id] ?? ""}
                                onChange={(e) => {
                                  setPreview(null);
                                  setTitleFor((m) => ({ ...m, [id]: e.target.value }));
                                }}
                              >
                                <option value="">— title —</option>
                                {channelTitles.map((t) => (
                                  <option key={t.id} value={t.id} disabled={!t.intelligence_built_at}>
                                    {t.name}
                                    {t.intelligence_built_at ? "" : " (no intelligence)"}
                                  </option>
                                ))}
                              </select>
                            </td>
                            <td className="py-1 pr-3 text-muted text-[12px]">{item ? `“${item.angle.claim}”` : ""}</td>
                            <td className="py-1 num text-right">{item ? inr(item.estimate_inr) : ""}</td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                  {preview && !preview.ok && (
                    <ul className="text-[13px] text-rejected list-disc pl-5">
                      {preview.problems.map((p, i) => (
                        <li key={i}>{p}</li>
                      ))}
                    </ul>
                  )}
                  <div className="flex items-center gap-2">
                    <button className="btn" disabled={busy !== null || !presetId || fills().length !== picked.length} onClick={previewFill}>
                      {busy === "preview" ? "Estimating…" : "Estimate combined cost"}
                    </button>
                    {preview && (
                      <button className="btn btn-primary" disabled={busy !== null || !preview.ok} onClick={confirmFill}>
                        {busy === "fill" ? "Enqueuing…" : `Generate ${preview.items.length} · ${inr(preview.total_estimate_inr)}`}
                      </button>
                    )}
                  </div>
                </>
              )}
            </div>
          </>
        )}
        <ErrorBox error={error} />
      </section>
    </div>
  );
}
