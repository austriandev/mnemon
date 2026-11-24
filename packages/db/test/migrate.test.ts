import type { Sql } from "postgres";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { migrate } from "../src/migrate.ts";
import { createTestDatabase } from "./test-database.ts";

describe("migrate", () => {
  let sql: Sql;
  let drop: () => Promise<void>;

  beforeAll(async () => {
    ({ sql, drop } = await createTestDatabase());
  });
  afterAll(async () => {
    await drop();
  });

  it("applies every migration to an empty database, then nothing on a second run", async () => {
    expect(await migrate(sql)).toEqual([
      "0001_init",
      "0002_retrieval",
      "0003_unique_source",
      "0004_records",
      "0005_held_on",
      "0006_spend",
      "0007_citations_cascade",
      "0008_spend_access_code",
      "0009_meeting_owner",
      "0010_spend_transcription",
    ]);
    expect(await migrate(sql)).toEqual([]);
  });

  it("leaves pgvector installed and usable", async () => {
    const [row] = await sql`select '[1,2,3]'::vector <-> '[1,2,5]'::vector as distance`;

    expect(row?.distance).toBe(2);
  });
});
