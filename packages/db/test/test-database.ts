import { randomUUID } from "node:crypto";
import postgres, { type Sql } from "postgres";
import { databaseUrl } from "../src/config.ts";

/**
 * Creates an empty, uniquely named database for one test file and returns a
 * connection to it, plus a function that drops it. Tests never share state.
 */
export async function createTestDatabase(): Promise<{ sql: Sql; drop: () => Promise<void> }> {
  const adminUrl = databaseUrl();
  const admin = postgres(adminUrl, { max: 1, onnotice: () => {} });
  const name = `mnemon_test_${randomUUID().replaceAll("-", "")}`;
  try {
    await admin.unsafe(`create database ${name}`);
  } catch (error) {
    await admin.end();
    throw new Error(`Cannot reach Postgres at ${redact(adminUrl)}. Start it with \`pnpm db:up\`.`, {
      cause: error,
    });
  }
  const url = new URL(adminUrl);
  url.pathname = `/${name}`;
  const sql = postgres(url.toString(), { onnotice: () => {} });
  return {
    sql,
    drop: async () => {
      await sql.end();
      await admin.unsafe(`drop database if exists ${name} with (force)`);
      await admin.end();
    },
  };
}

function redact(url: string): string {
  const parsed = new URL(url);
  if (parsed.password) parsed.password = "***";
  return parsed.toString();
}

/**
 * Deterministic stand-in embeddings: chunk i gets the unit vector along axis i, so
 * the nearest chunk to axis i is chunk i. Model "fake-embed-1", 1024 dimensions.
 */
export function fakeEmbeddings(count: number, model = "fake-embed-1") {
  return { model, vectors: Array.from({ length: count }, (_, i) => unitVector(i)) };
}

export function unitVector(axis: number, dimensions = 1024): number[] {
  return Array.from({ length: dimensions }, (_, d) => (d === axis ? 1 : 0));
}
