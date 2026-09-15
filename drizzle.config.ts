import type { Config } from "drizzle-kit";

export default {
  schema: "./src/db/schema.ts",
  out: "./src/db/migrations",
  dialect: "postgresql",
  dbCredentials: {
    url: process.env.DATABASE_URL ?? "postgres://promo:promo@localhost:5432/promo",
  },
  strict: true,
  verbose: true,
} satisfies Config;
