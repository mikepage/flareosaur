/**
 * @title HTTP server: server-sent events
 * @difficulty intermediate
 * @tags workers, http, streaming
 * @group HTTP
 * @resource {https://developer.mozilla.org/en-US/docs/Web/API/Server-sent_events} MDN: server-sent events
 * @resource {https://effect.website/docs/stream/introduction/} Effect: Stream
 * @check GET /clock -> 200 "event: tick" "data: {\"n\":1" "data: {\"n\":3" "event: done" header:content-type~"text/event-stream"
 *
 * Server-sent events push updates from the server over one long-lived
 * response. The events are an Effect `Stream`, and `Sse.encode` turns it
 * into the `text/event-stream` wire format, so the producer is ordinary
 * stream code: here, a tick every 10ms, three times, then a final event.
 */

import { DateTime, Effect, Schedule, Stream } from "effect"
import { Sse } from "effect/encoding"
import { HttpRouter, HttpServerResponse } from "effect/http"
import * as Worker from "@mikepage/flareosaur/workers/worker"

const ticks = Stream.fromSchedule(Schedule.spaced("10 millis")).pipe(
  Stream.take(3),
  Stream.mapEffect((n) =>
    Effect.map(DateTime.now, (now): Sse.Event => ({
      _tag: "Event",
      event: "tick",
      id: String(n + 1),
      data: JSON.stringify({ n: n + 1, at: DateTime.formatIso(now) }),
    }))
  ),
  Stream.concat(Stream.make<[Sse.Event]>({ _tag: "Event", event: "done", id: "end", data: "bye" })),
)

const clock = HttpServerResponse.stream(
  ticks.pipe(Stream.pipeThroughChannel(Sse.encode()), Stream.encodeText),
  { contentType: "text/event-stream", headers: { "cache-control": "no-cache" } },
)

export default Worker.make({ fetch: HttpRouter.add("GET", "/clock", clock) })
