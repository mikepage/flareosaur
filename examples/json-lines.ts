/**
 * @title Stream JSON Lines data
 * @difficulty intermediate
 * @tags workers, encoding, streams
 * @group Data formats
 * @resource {https://jsonlines.org} JSON Lines
 * @check POST /events h:content-type=application/x-ndjson "{\"type\":\"click\",\"x\":1}\n{\"type\":\"view\"}\n{\"type\":\"click\",\"x\":2}" -> 200 "clicks: 2" "views: 1"
 * @check GET /export -> 200 "{\"id\":1" "{\"id\":3" header:content-type~"application/x-ndjson"
 *
 * JSON Lines (NDJSON) puts one JSON value per line, so a reader can process
 * records as they arrive. Request and response bodies are Effect streams:
 * parse an upload line by line, and produce a download one record at a
 * time, without holding either in memory.
 */

import { Effect, Layer, Schema, Stream } from "effect"
import { HttpRouter, HttpServerRequest, HttpServerResponse } from "effect/http"
import * as Json from "@mikepage/flareosaur/json"
import * as Worker from "@mikepage/flareosaur/workers/worker"

const Event = Schema.Struct({ type: Schema.Literals(["click", "view"]) })

const ingest = Effect.gen(function*() {
  const request = yield* HttpServerRequest.HttpServerRequest
  const counts = yield* request.stream.pipe(
    Stream.decodeText,
    Json.parseLines,
    Stream.mapEffect((value) => Schema.decodeUnknownEffect(Event)(value)),
    Stream.runFold(() => ({ click: 0, view: 0 }), (acc, e) => ({ ...acc, [e.type]: acc[e.type] + 1 })),
  )
  return HttpServerResponse.text(`clicks: ${counts.click}, views: ${counts.view}`)
}).pipe(Effect.orDie)

const exportAll = HttpServerResponse.stream(
  Stream.range(1, 3).pipe(Stream.map((id) => ({ id, name: `item ${id}` })), Json.stringifyLines, Stream.encodeText),
  { contentType: "application/x-ndjson" },
)

export default Worker.make({
  fetch: Layer.mergeAll(HttpRouter.add("POST", "/events", ingest), HttpRouter.add("GET", "/export", exportAll)),
})
