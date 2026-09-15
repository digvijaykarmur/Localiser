import { notFound } from "next/navigation";
import { PromoError } from "@/domain";
import { allFormats } from "@/services/formats";
import { estimateIntelligence } from "@/services/intelligence/build";
import { getTiersForDialect } from "@/services/metrics/ppp";
import { listPresets } from "@/services/recipes";
import { getAngles, getEvidence, getTitle } from "@/services/titles";
import { loadPack } from "@/services/dialects";
import { TitleWorkspace } from "@/components/TitleWorkspace";

export const dynamic = "force-dynamic";

export default async function TitlePage({ params, searchParams }: { params: { titleId: string }; searchParams: { tab?: string; angle?: string } }) {
  let title;
  try {
    title = await getTitle(params.titleId);
  } catch (e) {
    if (e instanceof PromoError && e.code === "NOT_FOUND") notFound();
    throw e;
  }
  const [evidence, angles, presets, tiers] = await Promise.all([getEvidence(title.id), getAngles(title.id), listPresets(), getTiersForDialect(title.dialect)]);
  const estimate = title.intelligence_built_at ? null : await estimateIntelligence(title.id).catch(() => null);
  const pack = loadPack(title.dialect);
  return (
    <TitleWorkspace
      title={title}
      evidence={evidence}
      angles={angles}
      presets={presets}
      tiers={tiers}
      formats={allFormats()}
      estimate={estimate}
      ctaVariants={Object.keys(pack.cta_templates)}
      initialTab={searchParams.tab === "angles" || searchParams.tab === "compose" ? searchParams.tab : "evidence"}
      initialAngle={searchParams.angle ?? null}
    />
  );
}
