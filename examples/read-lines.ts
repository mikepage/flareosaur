/**
 * @title Read a stream line by line
 * @difficulty beginner
 * @tags workers, streams
 * @group Data formats
 * @resource {https://effect.website/docs/stream/introduction/} Effect: Stream
 * @check POST /log h:content-type=text/plain "INFO start\nERROR disk full\nINFO retry\nERROR timeout\n" -> 200 "2 errors" "ERROR disk full" "ERROR timeout"
 *
 * Command line tools read input line by line; a Worker does the same with a
 * request body or an R2 object. `toLines` decodes bytes and splits lines
 * across chunk boundaries, and the rest is ordinary stream code: filter,
 * take, count, without buffering the whole input.
 */

import { Effect, Stream } from "effect"
import { HttpRouter, HttpServerRequest, HttpServerResponse } from "effect/http"
import * as Streams from "@mikepage/flareosaur/streams"
import * as Worker from "@mikepage/flareosaur/workers/worker"

const errors = Effect.gen(function*() {
  const request = yield* HttpServerRequest.HttpServerRequest
  const lines = yield* request.stream.pipe(
    Streams.toLines(),
    Stream.filter((line) => line.startsWith("ERROR")),
    Stream.runCollect,
  )
  const all = Array.from(lines)
  return HttpServerResponse.text(`${all.length} errors:\n${all.join("\n")}`)
}).pipe(Effect.orDie)

export default Worker.make({ fetch: HttpRouter.add("POST", "/log", errors) })
