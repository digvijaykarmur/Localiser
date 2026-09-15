import { migrate } from "drizzle-orm/postgres-js/migrator";
import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import path from "node:path";

const url = process.env.DATABASE_URL ?? "postgres://promo:promo@localhost:5432/promo";

export async function runMigrations(): Promise<void> {
  const sql = postgres(url, { max: 1, onnotice: () => {} });
  const db = drizzle(sql);
  await migrate(db, { migrationsFolder: path.resolve(process.cwd(), "src/db/migrations") });
  await sql.end();
}

const isMain = process.argv[1] && /migrate\.ts$/.test(process.argv[1]);
if (isMain) {
  runMigrations()
    .then(() => {
      console.log("migrations applied");
      process.exit(0);
    })
    .catch((e) => {
      console.error(e);
      process.exit(1);
    });
}
