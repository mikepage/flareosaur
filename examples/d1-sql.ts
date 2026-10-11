/**
 * @title D1: SQL with Effect
 * @difficulty intermediate
 * @tags workers, d1, sql
 * @group Cloudflare runtime
 * @bindings d1:DB
 * @resource {https://developers.cloudflare.com/d1/} Cloudflare: D1
 * @resource {https://effect.website/docs/sql/} Effect: SQL
 * @check POST /todos h:content-type=application/json {"title":"Write examples"} -> 201 "Write examples"
 * @check POST /todos h:content-type=application/json {"title":"Ship"} -> 201
 * @check POST /todos h:content-type=application/json {"title":""} -> 400
 * @check PATCH /todos/1 -> 200 "\"done\":true"
 * @check GET /todos -> 200 "Write examples" "Ship" "\"done\":true"
 *
 * The Deno examples use SQLite through `node:sqlite`; a Worker has D1, a
 * SQLite database as a binding. `@effect/sql-d1` makes it an Effect
 * `SqlClient`: queries are tagged templates with parameters bound safely,
 * and rows are decoded with a Schema.
 */

import { D1Client } from "@effect/sql-d1"
import { Effect, Layer, Schema } from "effect"
import { HttpRouter, HttpServerRequest, HttpServerResponse } from "effect/http"
import { SqlClient } from "effect/sql"
import * as Worker from "@mikepage/flareosaur/workers/worker"

class Todo extends Schema.Class<Todo>("Todo")({
  id: Schema.Int,
  title: Schema.NonEmptyString,
  // SQLite has no booleans: 0 or 1 in the table, a boolean in the app.
  done: Schema.BooleanFromBit,
}) {}

// The SqlClient comes from the D1 binding.
const D1 = Layer.unwrap(Effect.map(Worker.binding("DB"), (db) => D1Client.layer({ db: db as never })))

// A one-statement migration, run once per isolate when the layer is built.
const Migrations = Layer.effectDiscard(Effect.gen(function*() {
  const sql = yield* SqlClient.SqlClient
  yield* sql`CREATE TABLE IF NOT EXISTS todos (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    title TEXT NOT NULL,
    done INTEGER NOT NULL DEFAULT 0
  )`
}))

const Database = Migrations.pipe(Layer.provideMerge(D1))

const decodeTodos = Schema.decodeUnknownEffect(Schema.Array(Todo))

const routes = Layer.mergeAll(
  HttpRouter.add("GET", "/todos", Effect.gen(function*() {
    const sql = yield* SqlClient.SqlClient
    const todos = yield* decodeTodos(yield* sql`SELECT id, title, done FROM todos ORDER BY id`)
    return HttpServerResponse.jsonUnsafe(todos)
  })),

  HttpRouter.add(
    "POST",
    "/todos",
    Effect.gen(function*() {
      const { title } = yield* HttpServerRequest.schemaBodyJson(Schema.Struct({ title: Schema.NonEmptyString }))
      const sql = yield* SqlClient.SqlClient
      // Interpolated values become bound parameters, never SQL text.
      const rows = yield* sql`INSERT INTO todos (title) VALUES (${title}) RETURNING id, title, done`
      const [todo] = yield* decodeTodos(rows)
      return HttpServerResponse.jsonUnsafe(todo, { status: 201 })
    }).pipe(Effect.catchTag("SchemaError", () => Effect.succeed(HttpServerResponse.text("invalid todo", { status: 400 })))),
  ),

  HttpRouter.add("PATCH", "/todos/:id", Effect.gen(function*() {
    const { id } = yield* HttpRouter.schemaPathParams(Schema.Struct({ id: Schema.FiniteFromString }))
    const sql = yield* SqlClient.SqlClient
    const [todo] = yield* decodeTodos(yield* sql`UPDATE todos SET done = 1 WHERE id = ${id} RETURNING id, title, done`)
    return todo ? HttpServerResponse.jsonUnsafe(todo) : HttpServerResponse.text("not found", { status: 404 })
  })),
)

export default Worker.make({ layer: Database, fetch: routes })
