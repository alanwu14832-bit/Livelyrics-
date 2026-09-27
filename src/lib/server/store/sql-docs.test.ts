// The cloud document store against a real Postgres (PGlite, WASM).

import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { createSqlDocumentStore, DOCS_TABLE, type SqlClient } from "./sql-docs";
import { createTestDatabase, type TestDatabase } from "./testing/pglite";

let tdb: TestDatabase;

beforeAll(async () => {
  tdb = await createTestDatabase();
}, 60_000);

afterAll(async () => {
  await tdb?.close();
});

beforeEach(async () => {
  await tdb.db.exec(`DROP TABLE IF EXISTS ${DOCS_TABLE}`);
  tdb.statements.length = 0;
});

describe("createSqlDocumentStore", () => {
  it("creates its table on first use and round-trips documents exactly", async () => {
    const store = createSqlDocumentStore(tdb.client, { retryDelayMs: 0 });
    expect(await store.get("project", "nope")).toBeNull();
    expect(tdb.statements[0]).toMatch(/CREATE TABLE IF NOT EXISTS livelyrics_docs/);

    // key order and characters survive (json, not jsonb), including a NUL character
    const data = { z: 1, a: { y: [1, 2.5, null], b: "歌詞\u0000尾" }, id: "x" };
    const created = await store.create("project", async (id) => ({ data: { ...data, id } }));
    expect(created.id).toMatch(/^[0-9a-f]{12}$/);
    const read = await store.get("project", created.id);
    expect(JSON.stringify(read!.data)).toBe(JSON.stringify({ ...data, id: created.id }));
    expect(Date.parse(read!.updatedAt)).toBeGreaterThan(Date.now() - 60_000);

    // kinds are separate namespaces
    expect(await store.get("band", created.id)).toBeNull();
    expect(await store.delete("band", created.id)).toBe(false);
    expect(await store.delete("project", created.id)).toBe(true);
    expect(await store.get("project", created.id)).toBeNull();
    expect(await store.delete("project", created.id)).toBe(false);
  });

  it("updates atomically, never recreates a deleted document, and can skip a write", async () => {
    const store = createSqlDocumentStore(tdb.client, { retryDelayMs: 0 });
    const doc = await store.create("band", async (id) => ({ data: { id, n: 0 } }));
    const updated = await store.update("band", doc.id, (d) => ({ data: { ...(d.data as object), n: 1 } }));
    expect(updated.data).toEqual({ id: doc.id, n: 1 });
    const unchanged = await store.update("band", doc.id, () => null);
    expect(unchanged.data).toEqual({ id: doc.id, n: 1 });

    await store.put("band", doc.id, { data: { id: doc.id, n: 5 } });
    expect((await store.get("band", doc.id))!.data).toEqual({ id: doc.id, n: 5 });

    await store.delete("band", doc.id);
    await expect(store.update("band", doc.id, (d) => ({ data: d.data as object }))).rejects.toMatchObject({ code: "not_found" });
    await expect(store.put("band", doc.id, { data: {} })).rejects.toMatchObject({ code: "not_found" });
    expect(await store.get("band", doc.id)).toBeNull();
  });

  it("re-applies a change after a concurrent write (optimistic versions): no update is lost", async () => {
    const store = createSqlDocumentStore(tdb.client, { retryDelayMs: 0 });
    const doc = await store.create("show", async (id) => ({ data: { id, fields: {} as Record<string, number> } }));
    // 12 writers at once, each adding its own field
    await Promise.all(
      Array.from({ length: 12 }, (_, i) =>
        store.update("show", doc.id, (d) => {
          const cur = d.data as { id: string; fields: Record<string, number> };
          return { data: { ...cur, fields: { ...cur.fields, [`f${i}`]: i } } };
        }),
      ),
    );
    const fields = ((await store.get("show", doc.id))!.data as { fields: Record<string, number> }).fields;
    expect(Object.keys(fields).sort()).toEqual(Array.from({ length: 12 }, (_, i) => `f${i}`).sort());
  });

  it("detects a lost race deterministically and retries the mutation on fresh data", async () => {
    const store = createSqlDocumentStore(tdb.client, { retryDelayMs: 0 });
    const doc = await store.create("project", async (id) => ({ data: { id, v: "a" } }));
    let calls = 0;
    const result = await store.update("project", doc.id, async (d) => {
      calls++;
      // the first attempt is overtaken by another writer
      if (calls === 1) await store.put("project", doc.id, { data: { id: doc.id, v: "b" } });
      return { data: { ...(d.data as object), seen: (d.data as { v: string }).v } };
    });
    expect(calls).toBe(2);
    expect(result.data).toEqual({ id: doc.id, v: "b", seen: "b" });
  });

  it("gives up with a conflict after too many concurrent changes", async () => {
    const store = createSqlDocumentStore(tdb.client, { retryDelayMs: 0, maxAttempts: 2 });
    const doc = await store.create("project", async (id) => ({ data: { id } }));
    await expect(
      store.update("project", doc.id, async (d) => {
        await store.put("project", doc.id, { data: { id: doc.id, other: Math.random() } });
        return { data: d.data as object };
      }),
    ).rejects.toMatchObject({ code: "conflict" });
  });

  it("lists stored summaries of the current version and recomputes stale or missing ones", async () => {
    const store = createSqlDocumentStore(tdb.client, { retryDelayMs: 0 });
    const a = await store.create("project", async (id) => ({ data: { id, title: "A", big: "x".repeat(1000) }, summary: { version: 2, value: { id, title: "A" } } }));
    const b = await store.create("project", async (id) => ({ data: { id, title: "B" }, summary: { version: 1, value: { id, title: "old" } } }));
    const c = await store.create("project", async (id) => ({ data: { id, title: "C" } }));
    await store.create("band", async (id) => ({ data: { id, title: "band" } }));

    const mapped: string[] = [];
    const list = await store.list("project", {
      summary: 2,
      map: (doc) => {
        mapped.push(doc.id);
        return { id: doc.id, title: (doc.data as { title: string }).title };
      },
    });
    const byId = new Map(list.map((e) => [e.id, "value" in e ? e.value : e.error]));
    expect(byId.get(a.id)).toEqual({ id: a.id, title: "A" });
    expect(byId.get(b.id)).toEqual({ id: b.id, title: "B" });
    expect(byId.get(c.id)).toEqual({ id: c.id, title: "C" });
    // only the stale and missing summaries needed the document
    expect(mapped.sort()).toEqual([b.id, c.id].sort());
    expect(list).toHaveLength(3);

    // a document the mapper cannot read becomes an error entry, not a failed list
    const broken = await store.list("band", {
      map: () => {
        throw new Error("broken");
      },
    });
    expect(broken[0]).toMatchObject({ error: expect.any(Error) });
  });

  it("tolerates two instances creating the table at the same time", async () => {
    const racing: SqlClient = {
      async query(text, params) {
        if (/CREATE TABLE/.test(text)) {
          // the other instance won the race: creating now fails like Postgres does
          await tdb.client.query(text, params);
          throw Object.assign(new Error('duplicate key value violates unique constraint "pg_type_typname_nsp_index"'), { code: "23505" });
        }
        return tdb.client.query(text, params);
      },
    };
    const store = createSqlDocumentStore(racing, { retryDelayMs: 0 });
    const doc = await store.create("project", async (id) => ({ data: { id } }));
    expect(await store.get("project", doc.id)).not.toBeNull();
  });

  it("retries the schema after a failed first attempt", async () => {
    let fail = true;
    const flaky: SqlClient = {
      async query(text, params) {
        if (fail && /CREATE TABLE/.test(text)) {
          fail = false;
          throw new Error("network down");
        }
        return tdb.client.query(text, params);
      },
    };
    const store = createSqlDocumentStore(flaky, { retryDelayMs: 0 });
    await expect(store.get("project", "abc")).rejects.toThrow("network down");
    expect(await store.get("project", "abc")).toBeNull();
  });
});
