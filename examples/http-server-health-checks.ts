/**
 * @title Health checks
 * @difficulty beginner
 * @tags workers, http
 * @group HTTP
 * @bindings kv:CACHE
 * @resource {https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Global_Objects/Promise/all} MDN: Promise.all()
 * @resource {https://jsr.io/@std/async/doc/deadline} @std/async: deadline
 * @resource {https://developers.cloudflare.com/kv/api/write-key-value-pairs/} Workers KV: write key-value pairs
 * @check GET /healthz -> 200 "ok"
 * @check GET /readyz -> 200 "\"kv\":\"ok\"" "\"upstream\":\"ok\""
 *
 * A liveness endpoint answers as long as the Worker runs. A readiness
 * endpoint checks the dependencies. The checks run concurrently, each with a
 * timeout, and a failing check is reported instead of failing the endpoint.
 */

import { deadline } from "@mikepage/flareosaur/async/deadline";
import { delay } from "@mikepage/flareosaur/async/delay";

interface Env {
  CACHE: KVNamespace;
}

// One check: "ok" if it settles within 500 ms, otherwise "failing".
// deadline rejects with a DOMException named TimeoutError when time is up.
async function check(work: Promise<unknown>): Promise<string> {
  try {
    await deadline(work, 500);
    return "ok";
  } catch {
    return "failing";
  }
}

async function readiness(env: Env): Promise<Response> {
  // Start every check at once, then wait for all of them. check never
  // rejects, so Promise.all is enough here.
  const [kv, upstream] = await Promise.all([
    check(env.CACHE.put("health", String(Date.now()))),
    // A stand-in for an upstream API call.
    check(delay(10)),
  ]);
  const results = { kv, upstream };
  const healthy = Object.values(results).every((r) => r === "ok");
  return Response.json(results, { status: healthy ? 200 : 503 });
}

export default {
  async fetch(request, env): Promise<Response> {
    const { pathname } = new URL(request.url);
    if (pathname === "/healthz") return new Response("ok");
    if (pathname === "/readyz") return await readiness(env);
    return new Response("Not found", { status: 404 });
  },
} satisfies ExportedHandler<Env>;
