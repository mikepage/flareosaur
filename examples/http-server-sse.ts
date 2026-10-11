/**
 * @title Server-sent events
 * @difficulty intermediate
 * @tags workers, http, streaming
 * @group HTTP
 * @resource {https://developer.mozilla.org/en-US/docs/Web/API/Server-sent_events} MDN: server-sent events
 * @resource {https://developer.mozilla.org/en-US/docs/Web/API/Streams_API} MDN: Streams API
 * @resource {https://jsr.io/@std/http/doc/server-sent-event-stream} @std/http: ServerSentEventStream
 * @check GET /clock -> 200 "event:tick" "data:{\"n\":1" "data:{\"n\":3" "event:done" header:content-type~"text/event-stream"
 *
 * Server-sent events push updates from the server over one long-lived
 * response. The events are a `ReadableStream` of message objects, and
 * `ServerSentEventStream` turns them into the `text/event-stream` wire
 * format. Here: a tick every 10 ms, three times, then a final event.
 */

import {
  type ServerSentEventMessage,
  ServerSentEventStream,
} from "@mikepage/flareosaur/http/server-sent-event-stream";
import { delay } from "@mikepage/flareosaur/async/delay";

// The producer. An async generator is the simplest way to write a sequence
// that waits between items.
async function* ticks(
  signal: AbortSignal,
): AsyncGenerator<ServerSentEventMessage> {
  for (let n = 1; n <= 3; n++) {
    // delay rejects when the client disconnects, which ends the generator.
    await delay(10, { signal });
    yield {
      event: "tick",
      id: n,
      data: JSON.stringify({ n, at: new Date().toISOString() }),
    };
  }
  yield { event: "done", id: "end", data: "bye" };
}

export default {
  fetch(request: Request): Response {
    if (new URL(request.url).pathname !== "/clock") {
      return new Response("Not Found", { status: 404 });
    }
    // A pull-based ReadableStream asks the generator for the next event
    // whenever the client is ready for more. The request's signal aborts
    // when the client goes away, so nothing outlives the request.
    const events = ticks(request.signal);
    const body = new ReadableStream<ServerSentEventMessage>({
      async pull(controller) {
        const { value, done } = await events.next();
        if (done) controller.close();
        else controller.enqueue(value);
      },
      async cancel() {
        await events.return(undefined);
      },
    }).pipeThrough(new ServerSentEventStream());
    return new Response(body, {
      headers: {
        "content-type": "text/event-stream",
        "cache-control": "no-cache",
      },
    });
  },
} satisfies ExportedHandler;
