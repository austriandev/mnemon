import { readdir, readFile } from "node:fs/promises";
import type { Sql } from "postgres";

const MIGRATIONS_DIR = new URL("../migrations/", import.meta.url);
// Arbitrary constant: serialises concurrent `migrate` runs (e.g. two app replicas starting).
const MIGRATION_LOCK = 7_413_220_001;

/**
 * Applies pending SQL migrations from `migrations/`, in file-name order, in one
 * transaction. Returns the versions applied by this run (empty when up to date).
 */
export async function migrate(sql: Sql): Promise<string[]> {
  const files = (await readdir(MIGRATIONS_DIR)).filter((f) => f.endsWith(".sql")).sort();
  return sql.begin(async (tx) => {
    await tx`select pg_advisory_xact_lock(${MIGRATION_LOCK})`;
    await tx`
      create table if not exists schema_migrations (
        version text primary key,
        applied_at timestamptz not null default now()
      )`;
    const done = new Set(
      (await tx<{ version: string }[]>`select version from schema_migrations`).map(
        (r) => r.version,
      ),
    );
    const applied: string[] = [];
    for (const file of files) {
      const version = file.replace(/\.sql$/, "");
      if (done.has(version)) continue;
      await tx.unsafe(await readFile(new URL(file, MIGRATIONS_DIR), "utf8"));
      await tx`insert into schema_migrations (version) values (${version})`;
      applied.push(version);
    }
    return applied;
  });
}
