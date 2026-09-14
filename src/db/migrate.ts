import postgres from "postgres";
import fs from "node:fs";
import path from "node:path";

async function main() {
  const url = process.env.DATABASE_URL ?? "postgres://stage:stage@localhost:5432/stage_promo";
  const sql = postgres(url, { max: 1 });
  const file = path.resolve(process.cwd(), "drizzle/0000_init.sql");
  const body = fs.readFileSync(file, "utf8");
  await sql.unsafe(body);
  await sql.end({ timeout: 5 });
  console.log("migrated");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
