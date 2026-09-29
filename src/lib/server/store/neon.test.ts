// The production adapter (Neon's HTTP driver) end to end, against PGlite behind a stand-in for
// Neon's SQL-over-HTTP endpoint: the driver sends `{ query, params }` and parses raw text values by
// their type OIDs, exactly as it does against Neon. This checks the SQL, the parameters and the
// type parsing the document store relies on (json, integer, float8, text).

import { neonConfig } from "@neondatabase/serverless";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { neonSqlClient } from "./neon";
import { createSqlDocumentStore } from "./sql-docs";
import { createTestDatabase, type TestDatabase } from "./testing/pglite";

let tdb: TestDatabase;
const requests: Array<{ url: string; headers: Record<string, string>; body: { query: string; params: unknown[] } }> = [];

// every type the store reads comes back as the text Postgres would send
const RAW_TYPES = [16, 19, 20, 21, 23, 25, 26, 114, 700, 701, 1043, 1082, 1114, 1184, 1700, 2205, 3802];
const raw = Object.fromEntries(RAW_TYPES.map((oid) => [oid, (v: string) => v]));

beforeAll(async () => {
  tdb = await createTestDatabase();
  neonConfig.fetchFunction = async (url: string, init: { body: string; headers: Record<string, string> }) => {
    const body = JSON.parse(init.body) as { query: string; params: unknown[] };
    requests.push({ url: String(url), headers: init.headers, body });
    try {
      const result = await tdb.db.query<unknown[]>(body.query, body.params, { rowMode: "array", parsers: raw });
      return new Response(
        JSON.stringify({
          command: body.query.trim().split(/\s+/)[0].toUpperCase(),
          rowCount: result.rows.length,
          fields: result.fields.map((f) => ({ name: f.name, dataTypeID: f.dataTypeID })),
          rows: result.rows.map((row) => row.map((v) => (v == null ? null : String(v)))),
        }),
        { status: 200, headers: { "content-type": "application/json" } },
      );
    } catch (err) {
      return new Response(JSON.stringify({ message: err instanceof Error ? err.message : String(err), code: (err as { code?: string }).code }), { status: 400 });
    }
  };
}, 60_000);

afterAll(async () => {
  neonConfig.fetchFunction = undefined;
  await tdb?.close();
});

describe("neonSqlClient (through @neondatabase/serverless)", () => {
  it("runs the document store with the real driver", async () => {
    const store = createSqlDocumentStore(neonSqlClient("postgresql://user:secret@ep-test-123.eu-central-1.aws.neon.tech/neondb?sslmode=require"), { retryDelayMs: 0 });
    const doc = await store.create("project", async (id) => ({ data: { id, title: "夜色之城", n: 1.25 }, summary: { version: 1, value: { id, title: "夜色之城" } } }));
    expect((await store.get("project", doc.id))!.data).toEqual({ id: doc.id, title: "夜色之城", n: 1.25 });

    const updated = await store.update("project", doc.id, (d) => ({ data: { ...(d.data as object), n: 2 }, summary: { version: 1, value: { id: doc.id, title: "夜色之城", n: 2 } } }));
    expect(updated.data).toMatchObject({ n: 2 });
    const list = await store.list("project", { summary: 1, map: () => ({ stale: true }) });
    expect(list).toEqual([{ id: doc.id, value: { id: doc.id, title: "夜色之城", n: 2 } }]);
    // a write without a summary clears it: the next list maps the document again
    await store.update("project", doc.id, (d) => ({ data: d.data as object }));
    expect(await store.list("project", { summary: 1, map: () => ({ stale: true }) })).toEqual([{ id: doc.id, value: { stale: true } }]);
    expect(await store.delete("project", doc.id)).toBe(true);

    // parameters travel separately from the SQL (no interpolation), with the connection string header
    const insert = requests.find((r) => r.body.query.startsWith("INSERT"))!;
    expect(insert.body.params[0]).toBe("project");
    expect(insert.body.query).not.toContain("夜色之城");
    expect(insert.headers["Neon-Connection-String"]).toContain("ep-test-123");
  });

  it("reports SQL errors as rejections", async () => {
    const client = neonSqlClient("postgresql://user:secret@ep-test-123.eu-central-1.aws.neon.tech/neondb");
    await expect(client.query("SELECT * FROM no_such_table")).rejects.toThrow(/no_such_table/);
  });
});
