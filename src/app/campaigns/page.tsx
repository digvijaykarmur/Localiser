import { CampaignBoard, type CampaignView } from "@/components/CampaignBoard";
import { listPresets } from "@/services/recipes";
import { listTitles } from "@/services/titles";
import { listCampaigns } from "@/services/tracker/campaigns";

export const dynamic = "force-dynamic";

/** J5 — the producer's weekly view (§10). */
export default async function CampaignsPage({ searchParams }: { searchParams: { c?: string } }) {
  const [campaigns, presets, titles] = await Promise.all([listCampaigns(), listPresets(), listTitles()]);
  return (
    <CampaignBoard
      campaigns={campaigns as CampaignView[]}
      presets={presets}
      titles={titles.map((t) => ({ id: t.id, name: t.name, name_native: t.name_native, dialect: t.dialect, intelligence_built_at: t.intelligence_built_at }))}
      initialId={searchParams.c ?? null}
    />
  );
}
