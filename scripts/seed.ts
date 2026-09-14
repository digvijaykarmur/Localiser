import { db, sql } from "@/db/client";
import { goldenSet } from "@/db/schema";
import { ingestTitle, buildIntelligence } from "@/services/intelligence";
import { getRedis } from "@/lib/redis";

async function main() {
  await ingestTitle("ttl_hry_01");
  await ingestTitle("ttl_raj_01");
  await buildIntelligence("ttl_hry_01");
  await buildIntelligence("ttl_raj_01");

  const dialects = ["hry", "raj", "bho", "guj", "mar", "ben"] as const;
  for (const d of dialects) {
    for (let i = 0; i < 30; i++) {
      const editor = 4 + (i % 6);
      const judge = editor + ((i % 3) - 1) * 0.4;
      await db
        .insert(goldenSet)
        .values({
          id: `gold_${d}_${i}`,
          dialect: d,
          promoId: `gold_${d}_${i}`,
          hook: editor,
          truth: editor,
          craft: editor,
          dialectScore: editor,
          editorOverall: editor,
          judgeA8: judge,
        })
        .onConflictDoNothing();
    }
  }
  await sql.end({ timeout: 2 }).catch(() => undefined);
  try {
    getRedis().disconnect();
  } catch {
    /* ignore */
  }
  console.log("seeded");
  process.exit(0);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
