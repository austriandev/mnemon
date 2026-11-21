// `pnpm db:migrate`: apply pending migrations to MNEMON_DATABASE_URL (or the local default).
import postgres from "postgres";
import { databaseUrl } from "./config.ts";
import { migrate } from "./migrate.ts";

const sql = postgres(databaseUrl(), { max: 1, onnotice: () => {} });
try {
  const applied = await migrate(sql);
  console.log(applied.length > 0 ? `Applied: ${applied.join(", ")}` : "Database is up to date.");
} finally {
  await sql.end();
}
