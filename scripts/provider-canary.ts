import { sql } from "@/db/client";
import { runCanary } from "@/services/metrics/canary";

runCanary()
  .then(async (rows) => {
    for (const r of rows) console.log(`${r.ok ? "ok  " : "FAIL"} ${r.provider.padEnd(10)} ${r.model.padEnd(28)} ${r.latency_ms}ms ${r.skipped ? `(${r.skipped})` : r.error ?? ""}`);
    await sql.end();
    process.exit(rows.some((r) => !r.ok) ? 1 : 0);
  })
  .catch(async (e) => {
    console.error(e);
    await sql.end();
    process.exit(1);
  });
