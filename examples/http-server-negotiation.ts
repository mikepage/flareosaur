/**
 * @title Content negotiation
 * @difficulty intermediate
 * @tags workers, http
 * @group HTTP
 * @resource {https://developer.mozilla.org/en-US/docs/Web/HTTP/Content_negotiation} MDN: content negotiation
 * @resource {https://jsr.io/@std/http/doc/negotiation} @std/http: negotiation
 * @check GET /greeting h:accept=application/json -> 200 "\"greeting\":\"Hello\"" header:content-type~"application/json"
 * @check GET /greeting h:accept=text/html h:accept-language=nl-NL,nl;q=0.9,en;q=0.5 -> 200 "<h1>Hallo</h1>" header:vary~"Accept-Language"
 * @check GET /greeting h:accept=image/png -> 406
 *
 * One URL can serve JSON to scripts and HTML to browsers, in the reader's
 * language. Negotiation reads the `Accept` and `Accept-Language` headers,
 * weighs their q-values, and picks the best of what the server offers.
 */

import {
  accepts,
  acceptsLanguages,
} from "@mikepage/flareosaur/http/negotiation";

// The languages we can answer in. The first is the fallback.
const GREETINGS = { en: "Hello", nl: "Hallo", fr: "Bonjour" } as const;
type Language = keyof typeof GREETINGS;

export default {
  fetch(request: Request): Response {
    const url = new URL(request.url);
    if (url.pathname !== "/greeting") {
      return new Response("Not Found", { status: 404 });
    }

    // accepts returns the best match among the types we offer, or
    // undefined when the client accepts none of them.
    const type = accepts(request, "application/json", "text/html");
    if (type === undefined) {
      return new Response("Not Acceptable", { status: 406 });
    }

    // acceptsLanguages works the same way for Accept-Language.
    const language: Language =
      acceptsLanguages(request, ...Object.keys(GREETINGS) as Language[]) ??
        "en";
    const text = GREETINGS[language];

    // The answer depends on these headers, so caches must key on them too.
    const headers = {
      "vary": "Accept, Accept-Language",
      "content-language": language,
    };
    if (type === "application/json") {
      return Response.json({ greeting: text, language }, { headers });
    }
    return new Response(`<h1>${text}</h1>`, {
      headers: { ...headers, "content-type": "text/html; charset=utf-8" },
    });
  },
} satisfies ExportedHandler;
