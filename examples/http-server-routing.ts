/**
 * @title Routing
 * @difficulty beginner
 * @tags workers, http
 * @group HTTP
 * @resource {https://effect.website/docs/platform/http-server/} Effect: HttpRouter
 * @check GET / -> 200 "Welcome"
 * @check GET /books/42 -> 200 "\"id\":42" "Book 42"
 * @check GET /books/abc -> 400
 * @check POST /books -> 201 "created"
 * @check GET /missing -> 404
 *
 * `HttpRouter` maps methods and paths to handlers. Path parameters are
 * decoded with a Schema, so `/books/abc` is rejected before the handler
 * runs. `Worker.make` serves the router as the Worker's fetch handler.
 */

import { Effect, Layer, Schema } from "effect"
import { HttpRouter, HttpServerResponse } from "effect/http"
import * as Worker from "@mikepage/flareosaur/workers/worker"

// Path parameters arrive as strings; the schema turns `id` into an integer
// and rejects anything else.
const BookParams = Schema.Struct({ id: Schema.FiniteFromString.check(Schema.isInt()) })

const routes = Layer.mergeAll(
  HttpRouter.add("GET", "/", HttpServerResponse.text("Welcome to the library")),

  HttpRouter.add(
    "GET",
    "/books/:id",
    Effect.gen(function*() {
      const { id } = yield* HttpRouter.schemaPathParams(BookParams)
      return HttpServerResponse.jsonUnsafe({ id, title: `Book ${id}` })
    }).pipe(
      // A param that does not decode is a client error.
      Effect.catchTag("SchemaError", () => Effect.succeed(HttpServerResponse.text("Bad id", { status: 400 }))),
    ),
  ),

  HttpRouter.add("POST", "/books", HttpServerResponse.text("created", { status: 201 })),
)

// Unmatched routes get a 404 from the router.
export default Worker.make({ fetch: routes })
