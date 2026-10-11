/**
 * @title Streaming responses
 * @difficulty beginner
 * @tags workers, http, streaming
 * @group HTTP
 * @resource {https://developer.mozilla.org/en-US/docs/Web/API/Streams_API} MDN: Streams API
 * @resource {https://developers.cloudflare.com/workers/runtime-apis/streams/} Workers: Streams
 * @check GET /count -> 200 "1\n2\n3\n4\n5\n"
 * @check POST /upper h:content-type=text/plain hello streaming world -> 200 "HELLO STREAMING WORLD"
 *
 * A response body can be a `ReadableStream`: bytes go out as they are
 * produced, so the Worker never holds the whole body in memory. Request
 * bodies are streams too, which makes a streaming transform a pipeline of
 * `pipeThrough` calls.
 */

// A number every 5 ms, written as it is produced. The stream's pull runs
// whenever the client is ready for more, so a slow client slows the
// producer down instead of filling memory.
function count(): Response {
  let n = 0;
  const numbers = new ReadableStream<string>({
    async pull(controller) {
      await new Promise((resolve) => setTimeout(resolve, 5));
      n++;
      controller.enqueue(`${n}\n`);
      if (n === 5) controller.close();
    },
  });
  // A body must be bytes: TextEncoderStream turns strings into UTF-8.
  return new Response(numbers.pipeThrough(new TextEncoderStream()), {
    headers: { "content-type": "text/plain; charset=utf-8" },
  });
}

// Echo the request body back in upper case, chunk by chunk.
function upper(request: Request): Response {
  if (!request.body) return new Response("Expected a body", { status: 400 });
  const body = request.body
    // Bytes to text. The decoder keeps a multi-byte character that is split
    // across two chunks in one piece.
    .pipeThrough(new TextDecoderStream())
    // A TransformStream changes each chunk as it passes.
    .pipeThrough(
      new TransformStream<string, string>({
        transform(chunk, controller) {
          controller.enqueue(chunk.toUpperCase());
        },
      }),
    )
    .pipeThrough(new TextEncoderStream());
  return new Response(body, {
    headers: { "content-type": "text/plain; charset=utf-8" },
  });
}

export default {
  fetch(request: Request): Response {
    const { pathname } = new URL(request.url);
    if (request.method === "GET" && pathname === "/count") return count();
    if (request.method === "POST" && pathname === "/upper") {
      return upper(request);
    }
    return new Response("Not found", { status: 404 });
  },
} satisfies ExportedHandler;
