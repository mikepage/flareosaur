/**
 * @title D1: SQL
 * @difficulty intermediate
 * @tags workers, d1, sql
 * @group Cloudflare
 * @bindings d1:DB
 * @resource {https://developers.cloudflare.com/d1/} Cloudflare: D1
 * @resource {https://developers.cloudflare.com/d1/worker-api/} Cloudflare: D1 Workers API
 * @check POST /todos h:content-type=application/json {"title":"Write examples"} -> 201 "Write examples"
 * @check POST /todos h:content-type=application/json {"title":"Ship"} -> 201
 * @check POST /todos h:content-type=application/json {"title":""} -> 400
 * @check PATCH /todos/1 -> 200 "\"done\":true"
 * @check PATCH /todos/99 -> 404
 * @check POST /todos/batch h:content-type=application/json ["Test","Deploy"] -> 201 "\"count\":2"
 * @check GET /todos -> 200 "Write examples" "Ship" "Deploy" "\"done\":true" "\"done\":false"
 *
 * The Deno examples use SQLite through `node:sqlite`; a Worker has D1, a
 * SQLite database as a binding. `prepare` a statement with `?` placeholders,
 * `bind` the values (they are never spliced into the SQL), then read with
 * `all`, `first` or `run`. `batch` sends several statements in one round
 * trip and runs them in a transaction.
 */

interface Env {
  DB: D1Database;
}

// Rows as SQLite returns them: no booleans, so done is 0 or 1.
interface Row {
  id: number;
  title: string;
  done: number;
}

const toTodo = (row: Row) => ({ ...row, done: row.done === 1 });

// In a real project this lives in a migration (wrangler d1 migrations).
// Here every request makes sure the table exists; IF NOT EXISTS makes it cheap.
const schema = `CREATE TABLE IF NOT EXISTS todos (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  title TEXT NOT NULL,
  done INTEGER NOT NULL DEFAULT 0
)`;

const todo = new URLPattern({ pathname: "/todos/:id(\\d+)" });

const isTitle = (value: unknown): value is string =>
  typeof value === "string" && value.trim() !== "";

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    await env.DB.prepare(schema).run();

    if (url.pathname === "/todos" && request.method === "GET") {
      const { results } = await env.DB.prepare(
        "SELECT id, title, done FROM todos ORDER BY id",
      ).all<Row>();
      return Response.json(results.map(toTodo));
    }

    if (url.pathname === "/todos" && request.method === "POST") {
      const body = await request.json<{ title?: unknown }>().catch(() => ({
        title: undefined,
      }));
      if (!isTitle(body.title)) {
        return new Response("invalid todo", { status: 400 });
      }
      // RETURNING gives back the new row; first() reads one row or null.
      const row = await env.DB.prepare(
        "INSERT INTO todos (title) VALUES (?) RETURNING id, title, done",
      )
        .bind(body.title)
        .first<Row>();
      return Response.json(toTodo(row!), { status: 201 });
    }

    // Several inserts, one round trip, all or nothing.
    if (url.pathname === "/todos/batch" && request.method === "POST") {
      const titles = await request.json().catch(() => null);
      if (!Array.isArray(titles) || !titles.every(isTitle)) {
        return new Response("invalid todos", { status: 400 });
      }
      const insert = env.DB.prepare("INSERT INTO todos (title) VALUES (?)");
      const results = await env.DB.batch(
        titles.map((title) => insert.bind(title)),
      );
      return Response.json({ count: results.length }, { status: 201 });
    }

    const id = todo.exec(url)?.pathname.groups.id;
    if (id && request.method === "PATCH") {
      const row = await env.DB.prepare(
        "UPDATE todos SET done = 1 WHERE id = ? RETURNING id, title, done",
      )
        .bind(Number(id))
        .first<Row>();
      return row
        ? Response.json(toTodo(row))
        : new Response("not found", { status: 404 });
    }

    return new Response("not found", { status: 404 });
  },
} satisfies ExportedHandler<Env>;
