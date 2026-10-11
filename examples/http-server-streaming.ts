/**
 * @title Streaming responses
 * @difficulty beginner
 * @tags workers, http, streaming
 * @group HTTP
 * @resource {https://effect.website/docs/stream/creating/} Effect: creating streams
 * @check GET /count -> 200 "1\n2\n3\n4\n5\n"
 * @check POST /upper h:content-type=text/plain hello streaming world -> 200 "HELLO STREAMING WORLD"
 *
 * A response body can be an Effect `Stream`: bytes go out as they are
 * produced, so the Worker never holds the whole body in memory. Request
 * bodies are streams too, which makes a streaming transform a pipeline.
 */

import { Effect, Layer, Schedule, Stream } from "effect"
import { HttpRouter, HttpServerResponse } from "effect/http"
import * as Worker from "@mikepage/flareosaur/workers/worker"

// A number every 5ms, written as it is produced.
const count = HttpServerResponse.stream(
  Stream.fromSchedule(Schedule.spaced("5 millis")).pipe(
    Stream.take(5),
    Stream.map((n) => `${n + 1}\n`),
    Stream.encodeText,
  ),
  { contentType: "text/plain" },
)

// Echo the request body back in upper case, chunk by chunk.
const upper = (request: { stream: Stream.Stream<Uint8Array, unknown> }) =>
  Effect.succeed(HttpServerResponse.stream(
    request.stream.pipe(Stream.decodeText, Stream.map((chunk) => chunk.toUpperCase()), Stream.encodeText),
    { contentType: "text/plain" },
  ))

export default Worker.make({
  fetch: Layer.mergeAll(HttpRouter.add("GET", "/count", count), HttpRouter.add("POST", "/upper", upper)),
})
