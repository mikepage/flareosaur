/**
 * @title Workers KV
 * @difficulty beginner
 * @tags workers, kv, storage
 * @group Cloudflare
 * @bindings kv:CACHE
 * @resource {https://developers.cloudflare.com/kv/} Cloudflare: Workers KV
 * @resource {https://developers.cloudflare.com/kv/api/} Cloudflare: KV API
 * @check PUT /prefs/ada h:content-type=application/json {"theme":"dark","fontSize":14} -> 200 "saved"
 * @check GET /prefs/ada -> 200 "\"theme\":\"dark\"" header:x-saved-at~"20"
 * @check PUT /prefs/bob h:content-type=application/json {"theme":"neon"} -> 400 "theme"
 * @check PUT /prefs/bob h:content-type=application/json not json -> 400
 * @check GET /prefs/carol -> 404
 * @check GET /visits -> 200 "visit 1"
 * @check GET /visits -> 200 "visit 2"
 *
 * Deno has Deno KV built in; a Worker gets Workers KV through a binding. KV
 * stores strings, streams or buffers under string keys, reads JSON with
 * `get(key, "json")`, and keeps a small metadata object and an optional
 * expiry next to each value. It is eventually consistent and made for many
 * reads and few writes; for exact counts use a Durable Object.
 */

interface Env {
  CACHE: KVNamespace;
}

interface Preferences {
  theme: "light" | "dark";
  fontSize?: number;
}

// KV holds whatever it is given, so check values coming in from a request.
// Returns the preferences, or a message saying what is wrong.
function parsePreferences(value: unknown): Preferences | string {
  if (typeof value !== "object" || value === null) return "expected an object";
  const { theme, fontSize } = value as Record<string, unknown>;
  if (theme !== "light" && theme !== "dark") {
    return "theme must be light or dark";
  }
  if (fontSize !== undefined && !Number.isInteger(fontSize)) {
    return "fontSize must be an integer";
  }
  return fontSize === undefined
    ? { theme }
    : { theme, fontSize: fontSize as number };
}

const prefs = new URLPattern({ pathname: "/prefs/:user" });

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    const user = prefs.exec(url)?.pathname.groups.user;

    if (user && request.method === "PUT") {
      const body = await request.json().catch(() => undefined);
      const result = parsePreferences(body);
      if (typeof result === "string") {
        return new Response(result, { status: 400 });
      }
      // Keys share one namespace, so prefix them. Metadata travels with the
      // value; expirationTtl (seconds, at least 60) deletes it after 30 days.
      await env.CACHE.put(`prefs:${user}`, JSON.stringify(result), {
        metadata: { savedAt: new Date().toISOString() },
        expirationTtl: 60 * 60 * 24 * 30,
      });
      return new Response("saved");
    }

    if (user && request.method === "GET") {
      // getWithMetadata parses the JSON and returns the metadata with it.
      const { value, metadata } = await env.CACHE.getWithMetadata<
        Preferences,
        { savedAt: string }
      >(
        `prefs:${user}`,
        "json",
      );
      if (value === null) return new Response("not found", { status: 404 });
      return Response.json(value, {
        headers: { "x-saved-at": metadata?.savedAt ?? "" },
      });
    }

    // A plain string value works for a rough counter. Two requests at the
    // same moment can both read 1 and write 2: fine for a demo, not for
    // billing.
    if (url.pathname === "/visits") {
      const visits = Number(await env.CACHE.get("visits") ?? "0") + 1;
      await env.CACHE.put("visits", String(visits));
      return new Response(`visit ${visits}`);
    }

    return new Response("not found", { status: 404 });
  },
} satisfies ExportedHandler<Env>;
