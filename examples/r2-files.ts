/**
 * @title R2: read and write files
 * @difficulty beginner
 * @tags workers, r2, storage
 * @group Cloudflare
 * @bindings r2:BUCKET
 * @resource {https://developers.cloudflare.com/r2/api/workers/workers-api-reference/} Cloudflare: R2 Workers API
 * @resource {https://developer.mozilla.org/en-US/docs/Web/API/URLPattern} MDN: URLPattern
 * @check PUT /files/notes/todo.txt buy milk -> 201 "notes/todo.txt"
 * @check GET /files/notes/todo.txt -> 200 "buy milk" header:content-type~"text/plain" header:etag~"\""
 * @check GET /files/notes/todo.txt h:if-none-match="{{prev:etag}}" -> 304
 * @check GET /files/notes/todo.txt h:range=bytes=0-2 -> 206 "buy" !"milk" header:content-range~"bytes 0-2/8"
 * @check PUT /files/notes/done.txt write examples -> 201
 * @check GET /objects -> 200 "notes/done.txt" "notes/todo.txt"
 * @check DELETE /files/notes/todo.txt -> 204
 * @check GET /files/notes/todo.txt -> 404
 *
 * A Worker has no disk; files go to an R2 bucket. The binding covers what
 * the Deno examples do with `Deno.readFile`, `Deno.writeFile`, `Deno.remove`
 * and walking a directory. Bodies are Web Streams in both directions, so a
 * large file never has to fit in memory. R2 also understands the request's
 * conditional and range headers, which makes it a small file server.
 */

interface Env {
  BUCKET: R2Bucket;
}

// Everything after /files/ is the object key, slashes included.
const file = new URLPattern({ pathname: "/files/:key+" });

export default {
  async fetch(request, env) {
    const url = new URL(request.url);

    // List: like walking a directory. list() returns up to 1000 keys per
    // page; pass `cursor` to get the next page.
    if (request.method === "GET" && url.pathname === "/objects") {
      const { objects } = await env.BUCKET.list({
        prefix: url.searchParams.get("prefix") ?? "",
      });
      return Response.json(objects.map((o) => ({ key: o.key, size: o.size })));
    }

    const key = file.exec(url)?.pathname.groups.key;
    if (!key) return new Response("not found", { status: 404 });

    switch (request.method) {
      // Write: the request body streams straight into the bucket.
      case "PUT": {
        // R2 needs to know the length of a stream up front. With a
        // Content-Length header the body streams; a chunked upload without
        // one is buffered first.
        const body = request.headers.has("content-length")
          ? request.body
          : await request.arrayBuffer();
        const object = await env.BUCKET.put(key, body, {
          httpMetadata: {
            contentType: request.headers.get("content-type") ??
              "text/plain; charset=utf-8",
          },
        });
        return Response.json({ key: object.key, size: object.size }, {
          status: 201,
        });
      }

      // Read: hand R2 the request headers. It evaluates If-None-Match,
      // If-Modified-Since and friends (onlyIf), and Range.
      case "GET": {
        const object = await env.BUCKET.get(key, {
          onlyIf: request.headers,
          range: request.headers,
        });
        if (!object) return new Response("not found", { status: 404 });

        // writeHttpMetadata copies the stored content type, cache control
        // and so on onto the response headers.
        const headers = new Headers({ etag: object.httpEtag });
        object.writeHttpMetadata(headers);

        // A failed precondition returns the object without a body.
        if (!("body" in object)) {
          return new Response(null, { status: 304, headers });
        }

        // A range read: answer 206 with the part that was asked for.
        const range = object.range as
          | { offset: number; length: number }
          | undefined;
        if (request.headers.has("range") && range) {
          const end = range.offset + range.length - 1;
          headers.set(
            "content-range",
            `bytes ${range.offset}-${end}/${object.size}`,
          );
          return new Response(object.body, { status: 206, headers });
        }
        return new Response(object.body, { headers });
      }

      case "DELETE":
        await env.BUCKET.delete(key);
        return new Response(null, { status: 204 });

      default:
        return new Response("method not allowed", {
          status: 405,
          headers: { allow: "GET, PUT, DELETE" },
        });
    }
  },
} satisfies ExportedHandler<Env>;
