import { z } from "zod";
import { jsonOk, jsonError } from "@/lib/http";
import { getAntryami } from "@/providers/antryami";
import { listCachedTitles } from "@/services/intelligence";
import { Title } from "@/domain";
import { providers } from "@/lib/env";

const Query = z.object({
  dialect: z.string().optional(),
  id: z.string().optional(),
});

const TitlesResponse = z.object({
  titles: z.array(Title),
});

export async function GET(req: Request) {
  try {
    const url = new URL(req.url);
    const q = Query.parse({
      dialect: url.searchParams.get("dialect") ?? undefined,
      id: url.searchParams.get("id") ?? undefined,
    });
    if (q.id) {
      const title = await getAntryami().getTitle(q.id);
      return jsonOk(TitlesResponse, { titles: [title] });
    }
    if (providers.antryami) {
      const remote = await getAntryami().listTitles({ dialect: q.dialect, limit: 40 });
      return jsonOk(TitlesResponse, { titles: remote.titles });
    }
    let titles = await listCachedTitles(q.dialect);
    if (!titles.length) {
      const remote = await getAntryami().listTitles({ dialect: q.dialect });
      titles = remote.titles;
    }
    return jsonOk(TitlesResponse, { titles });
  } catch (e) {
    return jsonError((e as Error).message, 500);
  }
}
