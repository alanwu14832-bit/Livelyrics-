// Neon's serverless driver over HTTPS (one fetch per query, nothing kept open between requests,
// which suits serverless functions). Created lazily, on the first storage call of an instance.

import { neon } from "@neondatabase/serverless";
import type { SqlClient } from "./sql-docs";

export function neonSqlClient(connectionString: string): SqlClient {
  const sql = neon(connectionString);
  return {
    query: (text, params = []) => sql.query(text, params) as Promise<Array<Record<string, unknown>>>,
  };
}
