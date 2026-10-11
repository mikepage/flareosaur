/**
 * @title HTTP server: paginating results
 * @difficulty intermediate
 * @tags workers, http, schema
 * @group HTTP
 * @resource {https://effect.website/docs/schema/introduction/} Effect: Schema
 * @check GET /items -> 200 "\"total\":42" "\"items\":[1,2,3,4,5,6,7,8,9,10]" "cursor=MTA"
 * @check GET /items?limit=5&cursor=NDA -> 200 "\"items\":[41,42]" "\"next\":null"
 * @check GET /items?limit=500 -> 400
 *
 * APIs that return lists need pagination. Query parameters are decoded with
 * a Schema (with defaults and limits), and the cursor is opaque to the
 * client: a base64url offset it hands back to get the next page.
 */

import { Effect, Option, Result, Schema } from "effect"
import { Base64Url } from "effect/encoding"
import { HttpRouter, HttpServerRequest, HttpServerResponse } from "effect/http"
import * as Worker from "@mikepage/flareosaur/workers/worker"

const ITEMS = Array.from({ length: 42 }, (_, i) => i + 1)

const Query = Schema.Struct({
  limit: Schema.optional(Schema.FiniteFromString.check(Schema.isInt(), Schema.isBetween({ minimum: 1, maximum: 100 }))),
  cursor: Schema.optional(Schema.String),
})

const list = Effect.gen(function*() {
  const query = yield* HttpServerRequest.schemaSearchParams(Query)
  const limit = query.limit ?? 10
  const offset = Option.match(Option.fromNullishOr(query.cursor), {
    onNone: () => 0,
    onSome: (cursor) => Number(Result.getOrElse(Base64Url.decodeString(cursor), () => "0")),
  })
  const items = ITEMS.slice(offset, offset + limit)
  const nextOffset = offset + items.length
  const next = nextOffset < ITEMS.length ? `/items?limit=${limit}&cursor=${Base64Url.encode(String(nextOffset))}` : null
  return HttpServerResponse.jsonUnsafe({ total: ITEMS.length, items, next })
}).pipe(Effect.catchTag("SchemaError", () => Effect.succeed(HttpServerResponse.text("bad query", { status: 400 }))))

export default Worker.make({ fetch: HttpRouter.add("GET", "/items", list) })
