/**
 * @title Content negotiation
 * @difficulty intermediate
 * @tags workers, http
 * @group HTTP
 * @resource {https://developer.mozilla.org/en-US/docs/Web/HTTP/Content_negotiation} MDN: content negotiation
 * @check GET /greeting h:accept=application/json -> 200 "\"greeting\":\"Hello\"" header:content-type~"application/json"
 * @check GET /greeting h:accept=text/html h:accept-language=nl-NL,nl;q=0.9,en;q=0.5 -> 200 "<h1>Hallo</h1>"
 * @check GET /greeting h:accept=image/png -> 406
 *
 * One URL can serve JSON to scripts and HTML to browsers, in the reader's
 * language. Negotiation reads the `Accept` and `Accept-Language` headers,
 * weighs their q-values, and picks the best of what the server offers; an
 * `Option` says when nothing fits.
 */

import { Effect, Option } from "effect"
import { HttpRouter, HttpServerResponse } from "effect/http"
import * as Negotiation from "@mikepage/flareosaur/http/negotiation"
import * as Worker from "@mikepage/flareosaur/workers/worker"

const GREETINGS = { en: "Hello", nl: "Hallo", fr: "Bonjour" } as const

const greeting = Effect.gen(function*() {
  const type = yield* Negotiation.negotiate(["application/json", "text/html"])
  const language = Option.getOrElse(yield* Negotiation.negotiateLanguage(["en", "nl", "fr"]), () => "en" as const)
  const text = GREETINGS[language]
  return Option.match(type, {
    onNone: () => HttpServerResponse.text("Not Acceptable", { status: 406 }),
    onSome: (t) =>
      t === "application/json"
        ? HttpServerResponse.jsonUnsafe({ greeting: text, language })
        : HttpServerResponse.html(`<h1>${text}</h1>`),
  })
})

export default Worker.make({ fetch: HttpRouter.add("GET", "/greeting", greeting) })
