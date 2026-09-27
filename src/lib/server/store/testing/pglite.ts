// Tests only: a real (WASM) Postgres for the SQL document store, behind the same `query(text,
// params) -> rows` interface the Neon driver is adapted to. PGlite is a dev dependency.

import { PGlite } from "@electric-sql/pglite";
import type { SqlClient } from "../sql-docs";

export interface TestDatabase {
  db: PGlite;
  client: SqlClient;
  /** every statement the store sent (text only) */
  statements: string[];
  close(): Promise<void>;
}

export async function createTestDatabase(): Promise<TestDatabase> {
  const db = new PGlite();
  await db.waitReady;
  const statements: string[] = [];
  const client: SqlClient = {
    async query(text, params = []) {
      statements.push(text);
      const result = await db.query<Record<string, unknown>>(text, params as unknown[]);
      return result.rows;
    },
  };
  return { db, client, statements, close: () => db.close() };
}
