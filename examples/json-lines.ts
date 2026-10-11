/**
 * @title Stream JSON Lines data
 * @difficulty intermediate
 * @tags workers, encoding, streams
 * @group Data formats
 * @resource {https://jsonlines.org} JSON Lines
 * @resource {https://jsr.io/@std/json} @std/json
 * @resource {https://jsr.io/@std/streams/doc/text-line-stream} @std/streams: TextLineStream
 * @check POST /events h:content-type=application/x-ndjson "{\"type\":\"click\",\"x\":1}\n{\"type\":\"view\"}\n{\"type\":\"click\",\"x\":2}" -> 200 "clicks: 2" "views: 1"
 * @check POST /events h:content-type=application/x-ndjson "{\"type\":\"click\"}\n{\"type\":\"hover\"}" -> 400 "unknown event"
 * @check GET /export -> 200 "{\"id\":1" "{\"id\":3" header:content-type~"application/x-ndjson"
 *
 * JSON Lines (NDJSON) puts one JSON value per line, so a reader can process
 * records as they arrive. Request and response bodies are web streams:
 * split an upload into lines with `TextLineStream` and parse each with
 * `JsonParseStream`. `JsonStringifyStream` produces a download one record
 * at a time. Neither side holds the whole body in memory.
 */

import {
  JsonParseStream,
  JsonStringifyStream,
} from "@mikepage/flareosaur/json";
import { TextLineStream } from "@mikepage/flareosaur/streams/text-line-stream";

async function ingest(body: ReadableStream<Uint8Array>): Promise<Response> {
  // Bytes, then text, then lines, then one JSON value per line.
  const events = body
    .pipeThrough(new TextDecoderStream())
    .pipeThrough(new TextLineStream())
    .pipeThrough(new JsonParseStream());

  const counts = { click: 0, view: 0 };
  for await (const event of events) {
    // Every value is untrusted JSON. Check it before counting.
    const type = (event as { type?: unknown } | null)?.type;
    if (type !== "click" && type !== "view") {
      return new Response(`unknown event: ${JSON.stringify(event)}`, {
        status: 400,
      });
    }
    counts[type]++;
  }
  return new Response(`clicks: ${counts.click}, views: ${counts.view}`);
}

function exportAll(): Response {
  // A stream of records, one JSON line each, encoded to bytes.
  // In a real Worker the records would come from D1 or R2, page by page.
  let id = 0;
  const items = new ReadableStream({
    pull(controller) {
      if (++id > 3) return controller.close();
      controller.enqueue({ id, name: `item ${id}` });
    },
  });
  const body = items
    .pipeThrough(new JsonStringifyStream())
    .pipeThrough(new TextEncoderStream());
  return new Response(body, {
    headers: { "content-type": "application/x-ndjson" },
  });
}

export default {
  async fetch(request): Promise<Response> {
    const { pathname } = new URL(request.url);
    if (request.method === "POST" && pathname === "/events" && request.body) {
      return await ingest(request.body);
    }
    if (request.method === "GET" && pathname === "/export") return exportAll();
    return new Response("Not found", { status: 404 });
  },
} satisfies ExportedHandler;
