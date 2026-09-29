// Cloud document store: one Postgres row per document.
//
//   livelyrics_docs(kind text, id text, data json, summary json, version integer,
//                   created_at timestamptz, updated_at timestamptz, primary key (kind, id))
//
// The table is created on first use (IF NOT EXISTS). `data` is `json`, not `jsonb`, on purpose:
// the document comes back exactly as written (key order, like the local JSON files), so nothing
// that compares serialized values sees a spurious change. Writes are optimistic: an update reads
// the row with its version, applies the change and writes it only if the version is unchanged,
// retrying on a concurrent change (the Neon HTTP driver has no interactive transactions, and no
// in-memory lock can be shared between serverless instances).
//
// Any client with `query(text, params) -> rows` fits: Neon's HTTP driver in production
// (store/neon.ts), PGlite in the tests.

import { StorageError } from "./errors";
import { newDocId } from "./ids";
import { LOCAL_LAYOUT } from "./local-docs";
import type { DocKind, DocumentStore, DocWrite, ListEntry, ListOptions, StoredDoc } from "./types";

export interface SqlClient {
  query(text: string, params?: unknown[]): Promise<Array<Record<string, unknown>>>;
}

export const DOCS_TABLE = "livelyrics_docs";

export const DOCS_SCHEMA = `CREATE TABLE IF NOT EXISTS ${DOCS_TABLE} (
  kind text NOT NULL,
  id text NOT NULL,
  data json NOT NULL,
  summary json,
  version integer NOT NULL DEFAULT 1,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (kind, id)
)`;

const UPDATED_MS = "(extract(epoch from updated_at) * 1000)::float8 AS updated_ms";

export interface SqlStoreOptions {
  /** attempts of an optimistic update before giving up (default 12) */
  maxAttempts?: number;
  /** backoff between attempts (tests pass 0) */
  retryDelayMs?: number;
}

function parseJson(v: unknown): unknown {
  return typeof v === "string" ? JSON.parse(v) : v;
}

function iso(ms: unknown): string {
  const n = Number(ms);
  return new Date(Number.isFinite(n) ? n : 0).toISOString();
}

function summaryJson(summary: DocWrite["summary"]): string | null {
  return summary ? JSON.stringify({ v: summary.version, value: summary.value }) : null;
}

function sleep(ms: number): Promise<void> {
  return ms > 0 ? new Promise((resolve) => setTimeout(resolve, ms)) : Promise.resolve();
}

export function createSqlDocumentStore(sql: SqlClient, options: SqlStoreOptions = {}): DocumentStore {
  const maxAttempts = options.maxAttempts ?? 12;
  const retryDelayMs = options.retryDelayMs ?? 25;
  let ready: Promise<void> | null = null;

  const ensure = (): Promise<void> => {
    ready ??= (async () => {
      try {
        await sql.query(DOCS_SCHEMA);
      } catch (err) {
        // two cold starts creating the table at the same moment: fine if it exists now
        const rows = await sql.query("SELECT to_regclass($1)::text AS t", [DOCS_TABLE]).catch(() => []);
        if (!rows[0]?.t) throw err;
      }
    })().catch((err) => {
      ready = null;
      throw err;
    });
    return ready;
  };

  const notFound = (kind: DocKind) => new StorageError("not_found", LOCAL_LAYOUT[kind].notFound);

  const readRow = async (kind: DocKind, id: string) => {
    const rows = await sql.query(`SELECT data, version, ${UPDATED_MS} FROM ${DOCS_TABLE} WHERE kind = $1 AND id = $2`, [kind, id]);
    if (!rows.length) return null;
    let data: unknown;
    try {
      data = parseJson(rows[0].data);
    } catch {
      throw new StorageError("corrupt", `${LOCAL_LAYOUT[kind].label(id)} 已損毀，無法讀取`);
    }
    return { doc: { id, data, updatedAt: iso(rows[0].updated_ms) } as StoredDoc, version: Number(rows[0].version) };
  };

  return {
    mode: "cloud",

    async get(kind, id) {
      await ensure();
      return (await readRow(kind, id))?.doc ?? null;
    },

    async create(kind, init) {
      await ensure();
      for (let attempt = 0; attempt < 8; attempt++) {
        const id = newDocId();
        const write = await init(id);
        const rows = await sql.query(
          `INSERT INTO ${DOCS_TABLE} (kind, id, data, summary) VALUES ($1, $2, $3::json, $4::json) ON CONFLICT (kind, id) DO NOTHING RETURNING ${UPDATED_MS}`,
          [kind, id, JSON.stringify(write.data), summaryJson(write.summary)],
        );
        if (rows.length) return { id, data: write.data, updatedAt: iso(rows[0].updated_ms) };
      }
      throw new Error(LOCAL_LAYOUT[kind].createError);
    },

    async update(kind, id, mutate) {
      await ensure();
      for (let attempt = 1; ; attempt++) {
        const row = await readRow(kind, id);
        if (!row) throw notFound(kind);
        const write = await mutate(row.doc);
        if (!write) return row.doc;
        const rows = await sql.query(
          `UPDATE ${DOCS_TABLE} SET data = $3::json, summary = $4::json, version = version + 1, updated_at = now() WHERE kind = $1 AND id = $2 AND version = $5 RETURNING ${UPDATED_MS}`,
          [kind, id, JSON.stringify(write.data), summaryJson(write.summary), row.version],
        );
        if (rows.length) return { id, data: write.data, updatedAt: iso(rows[0].updated_ms) };
        if (attempt >= maxAttempts) throw new StorageError("conflict", "資料同時被修改太多次，請再試一次");
        // someone else wrote in between: read again and re-apply (jittered backoff)
        await sleep(retryDelayMs * attempt * (0.5 + Math.random()));
      }
    },

    async put(kind, id, write) {
      await ensure();
      const rows = await sql.query(
        `UPDATE ${DOCS_TABLE} SET data = $3::json, summary = $4::json, version = version + 1, updated_at = now() WHERE kind = $1 AND id = $2 RETURNING ${UPDATED_MS}`,
        [kind, id, JSON.stringify(write.data), summaryJson(write.summary)],
      );
      if (!rows.length) throw notFound(kind);
      return { id, data: write.data, updatedAt: iso(rows[0].updated_ms) };
    },

    async delete(kind, id) {
      await ensure();
      const rows = await sql.query(`DELETE FROM ${DOCS_TABLE} WHERE kind = $1 AND id = $2 RETURNING id`, [kind, id]);
      return rows.length > 0;
    },

    async list<T>(kind: DocKind, opts: ListOptions<T>): Promise<ListEntry<T>[]> {
      await ensure();
      const version = opts.summary != null ? String(opts.summary) : null;
      // with a summary version, rows carry either their current summary or (stale / missing) the document
      const rows =
        version == null
          ? await sql.query(`SELECT id, NULL AS summary, data, ${UPDATED_MS} FROM ${DOCS_TABLE} WHERE kind = $1`, [kind])
          : await sql.query(
              `SELECT id,
                CASE WHEN summary->>'v' = $2 THEN summary->'value' END AS summary,
                CASE WHEN summary IS NULL OR summary->>'v' IS DISTINCT FROM $2 THEN data END AS data,
                ${UPDATED_MS}
               FROM ${DOCS_TABLE} WHERE kind = $1`,
              [kind, version],
            );
      return rows.map((row): ListEntry<T> => {
        const id = String(row.id);
        const updatedAt = iso(row.updated_ms);
        try {
          if (row.summary != null) return { id, value: parseJson(row.summary) as T };
          return { id, value: opts.map({ id, data: parseJson(row.data), updatedAt }) };
        } catch (error) {
          return { id, error, updatedAt };
        }
      });
    },
  };
}
