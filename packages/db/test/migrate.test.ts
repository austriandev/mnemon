import type { Sql } from "postgres";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { migrate } from "../src/index.ts";
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
    expect(await migrate(sql)).toEqual(["0001_init"]);
    expect(await migrate(sql)).toEqual([]);
  });

  it("leaves pgvector installed and usable", async () => {
    const [row] = await sql`select '[1,2,3]'::vector <-> '[1,2,5]'::vector as distance`;

    expect(row?.distance).toBe(2);
  });
});
