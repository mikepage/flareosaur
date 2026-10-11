/**
 * @title Read a stream line by line
 * @difficulty beginner
 * @tags workers, streams
 * @group Data formats
 * @resource {https://developer.mozilla.org/en-US/docs/Web/API/TextDecoderStream} MDN: TextDecoderStream
 * @resource {https://jsr.io/@std/streams/doc/text-line-stream} @std/streams: TextLineStream
 * @check POST /log h:content-type=text/plain "INFO start\nERROR disk full\nINFO retry\nERROR timeout\n" -> 200 "2 errors" "ERROR disk full" "ERROR timeout" !"INFO"
 * @check GET /log -> 405
 *
 * Command line tools read input line by line. A Worker does the same with
 * a request body or an R2 object. `TextDecoderStream` turns bytes into
 * text, std's `TextLineStream` splits it into lines across chunk
 * boundaries, and `for await` reads one line at a time without buffering
 * the whole input.
 */

import { TextLineStream } from "@mikepage/flareosaur/streams/text-line-stream";

export default {
  async fetch(request): Promise<Response> {
    const url = new URL(request.url);
    if (url.pathname !== "/log") {
      return new Response("Not found", { status: 404 });
    }
    if (request.method !== "POST" || !request.body) {
      return new Response("POST a log", { status: 405 });
    }

    // Bytes in, lines out. The body is never held in memory as a whole.
    const lines = request.body
      .pipeThrough(new TextDecoderStream())
      .pipeThrough(new TextLineStream());

    // A ReadableStream is async iterable.
    const errors: string[] = [];
    for await (const line of lines) {
      if (line.startsWith("ERROR")) errors.push(line);
    }
    return new Response(`${errors.length} errors:\n${errors.join("\n")}\n`);
  },
} satisfies ExportedHandler;
