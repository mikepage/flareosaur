/**
 * @title R2: reading and writing files
 * @difficulty beginner
 * @tags workers, r2, storage
 * @group Cloudflare runtime
 * @bindings r2:BUCKET
 * @resource {https://developers.cloudflare.com/r2/api/workers/workers-api-reference/} Cloudflare: R2 Workers API
 * @check PUT /files/notes/todo.txt buy milk -> 201 "notes/todo.txt"
 * @check GET /files/notes/todo.txt -> 200 "buy milk" header:content-type~"text/plain"
 * @check PUT /files/notes/done.txt write examples -> 201
 * @check GET /objects -> 200 "notes/done.txt" "notes/todo.txt"
 * @check DELETE /files/notes/todo.txt -> 204
 * @check GET /files/notes/todo.txt -> 404
 *
 * A Worker has no disk; files go to an R2 bucket. The `R2.Bucket` service
 * covers what the Deno examples do with `Deno.readFile`, `Deno.writeFile`,
 * `Deno.remove` and walking a directory, with typed errors and `Option` for
 * missing files. Object bodies are Effect `Stream`s, so large files never
 * have to fit in memory.
 */

import { Effect, Layer, Option } from "effect"
import { HttpRouter, HttpServerRequest, HttpServerResponse } from "effect/http"
import * as R2 from "@mikepage/flareosaur/workers/r2"
import * as Worker from "@mikepage/flareosaur/workers/worker"

// Everything after /files/ is the object key.
const keyOf = (request: HttpServerRequest.HttpServerRequest) =>
  decodeURIComponent(new URL(request.url, "http://localhost").pathname.slice("/files/".length))

const routes = Layer.mergeAll(
  // Write: stream the request body straight into the bucket.
  HttpRouter.add("PUT", "/files/*", (request) =>
    Effect.gen(function*() {
      const bucket = yield* R2.Bucket
      const object = yield* bucket.putStream(keyOf(request), request.stream, { contentType: "text/plain; charset=utf-8" })
      return HttpServerResponse.jsonUnsafe({ key: object.key, size: object.size }, { status: 201 })
    })),

  // Read: stream the object back with its content type.
  HttpRouter.add("GET", "/files/*", (request) =>
    Effect.gen(function*() {
      const bucket = yield* R2.Bucket
      return Option.match(yield* bucket.get(keyOf(request)), {
        onNone: () => HttpServerResponse.text("not found", { status: 404 }),
        onSome: (object) =>
          HttpServerResponse.stream(object.stream, {
            contentType: object.info.httpMetadata?.contentType ?? "application/octet-stream",
          }),
      })
    })),

  // List: like walking a directory.
  HttpRouter.add("GET", "/objects", Effect.gen(function*() {
    const objects = yield* (yield* R2.Bucket).list()
    return HttpServerResponse.jsonUnsafe(objects.map((o) => ({ key: o.key, size: o.size })))
  })),

  HttpRouter.add("DELETE", "/files/*", (request) =>
    Effect.gen(function*() {
      yield* (yield* R2.Bucket).remove(keyOf(request))
      return HttpServerResponse.empty({ status: 204 })
    })),
)

export default Worker.make({ layer: R2.layer("BUCKET"), fetch: routes })
