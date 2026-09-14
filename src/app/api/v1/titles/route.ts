import { z } from "zod";
import { jsonOk, jsonError } from "@/lib/http";
import { getAntryami } from "@/providers/antryami";
import { ingestTitle, listCachedTitles } from "@/services/intelligence";
import { Title } from "@/domain";

const Query = z.object({
  dialect: z.string().optional(),
});

const TitlesResponse = z.object({
  titles: z.array(Title),
});

export async function GET(req: Request) {
  try {
    const url = new URL(req.url);
    const q = Query.parse({ dialect: url.searchParams.get("dialect") ?? undefined });
    let titles = await listCachedTitles(q.dialect);
    if (!titles.length) {
      const remote = await getAntryami().listTitles({ dialect: q.dialect });
      for (const t of remote.titles) {
        await ingestTitle(t.id);
      }
      titles = await listCachedTitles(q.dialect);
    }
    return jsonOk(TitlesResponse, { titles });
  } catch (e) {
    return jsonError((e as Error).message, 500);
  }
}
