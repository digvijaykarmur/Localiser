import { notFound } from "next/navigation";
import { DialectCode } from "@/domain";
import { elevenlabs } from "@/providers";
import { loadFormat } from "@/services/formats";
import { loadPack, packHistory } from "@/services/dialects";
import { DialectPackForm } from "@/components/DialectPackForm";

export const dynamic = "force-dynamic";

export default async function DialectPage({ params }: { params: { code: string } }) {
  const code = DialectCode.safeParse(params.code);
  if (!code.success) notFound();
  const pack = loadPack(code.data);
  const [history, voices] = await Promise.all([packHistory(code.data), elevenlabs().then((el) => el.listVoices()).catch(() => [])]);
  const cp = loadFormat("CP");
  return <DialectPackForm initial={pack} voices={voices} history={history.map((h) => ({ version: h.version, saved_by: h.savedBy, created_at: h.createdAt.toISOString() }))} ctaDurationS={cp.cta_duration_s} />;
}
