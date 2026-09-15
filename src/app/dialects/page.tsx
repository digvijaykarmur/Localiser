import Link from "next/link";
import { packCompleteness } from "@/domain";
import { FORMAT_NAMES, type FormatCode } from "@/domain/primitives";
import { allPacks } from "@/services/dialects";
import { getTiersForDialect } from "@/services/metrics/ppp";

export const dynamic = "force-dynamic";

const TIER_CLS = { PROVE: "text-muted", PILOT: "text-minor", PRODUCTION: "text-approved" } as const;

/** J1 step 1 — six cards, each showing completeness (§6). */
export default async function DialectsPage() {
  const packs = allPacks();
  const tiers = await Promise.all(packs.map((p) => getTiersForDialect(p.code)));
  return (
    <div className="space-y-4">
      <header>
        <h1 className="text-lg font-medium">Dialect packs</h1>
        <div className="text-muted text-[13px]">Dialect is data, not instruction. Each pack is versioned; a promo records the version that produced it.</div>
      </header>
      <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-3">
        {packs.map((p, i) => {
          const c = packCompleteness(p);
          const t = tiers[i]!;
          return (
            <Link key={p.code} href={`/dialects/${p.code}`} className="panel p-4 hover:border-muted block space-y-2">
              <div className="flex items-baseline justify-between">
                <h2 className="font-medium">{p.name}</h2>
                <span className="num text-[12px] text-muted">{p.version}</span>
              </div>
              <div className="native-lg text-ink">{(p.cta_templates.default ?? "").split("{title}").join(p.name)}</div>
              <ul className="text-[13px] text-muted space-y-0.5">
                <li>
                  <span className={c.voice ? "text-approved" : "text-rejected"}>{c.voice ? "✓" : "✗"}</span> voice {c.voice ? "" : "— voice_id not set"}
                </li>
                <li>
                  <span className={c.rhythm ? "text-approved" : "text-rejected"}>{c.rhythm ? "✓" : "✗"}</span> rhythm · {p.rhythm.words_per_second} wps
                </li>
                <li>
                  <span className={c.lexicon_entries > 0 ? "text-approved" : "text-faint"}>{c.lexicon_entries > 0 ? "✓" : "○"}</span> lexicon {c.lexicon_entries} entries
                </li>
                <li>
                  <span className={c.taboo > 0 ? "text-approved" : "text-faint"}>{c.taboo > 0 ? "✓" : "○"}</span> taboo {c.taboo}
                </li>
                <li>
                  <span className="text-approved">✓</span> CTA {c.cta_variants} variant{c.cta_variants === 1 ? "" : "s"}
                </li>
              </ul>
              <div className="flex gap-2 text-[12px] num">
                {(Object.keys(FORMAT_NAMES) as FormatCode[]).map((f) => (
                  <span key={f} className={`chip ${TIER_CLS[t[f]]}`}>
                    {f} {t[f]}
                  </span>
                ))}
              </div>
            </Link>
          );
        })}
      </div>
    </div>
  );
}
