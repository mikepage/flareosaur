/**
 * @title Make HTTP requests
 * @difficulty beginner
 * @tags workers, http
 * @group HTTP
 * @bindings outbound:echo
 * @resource {https://effect.website/docs/platform/http-client/} Effect: HttpClient
 * @check GET / -> 200 "GET https://api.example.com/users?page=2" "POST body: {\"name\":\"Ada\"}" "status 503 failed: true" "retried 3 times"
 *
 * Effect's `HttpClient` wraps `fetch` with typed errors, Schema-decoded
 * responses, retries and timeouts. On Workers it runs on the runtime's own
 * `fetch` through `FetchHttpClient.layer`.
 */

import { Console, Effect, Ref, Schedule, Schema } from "effect"
import { FetchHttpClient, HttpClient, HttpClientRequest, HttpClientResponse } from "effect/http"
import { script } from "./_lib/script.ts"

// The (fake) upstream echoes the request back as JSON. schemaJson decodes
// the whole response, so the schema describes { status, headers, body }.
const Echo = Schema.Struct({
  body: Schema.Struct({ method: Schema.String, url: Schema.String, body: Schema.NullOr(Schema.String) }),
})

const program = Effect.gen(function*() {
  const client = yield* HttpClient.HttpClient

  // GET with query parameters, decoding the JSON body with a Schema.
  const { body: page } = yield* client.get("https://api.example.com/users", { urlParams: { page: 2 } }).pipe(
    Effect.flatMap(HttpClientResponse.schemaJson(Echo)),
  )
  yield* Console.log(`${page.method} ${page.url}`)

  // POST a JSON body.
  const { body: created } = yield* HttpClientRequest.post("https://api.example.com/users").pipe(
    HttpClientRequest.bodyJsonUnsafe({ name: "Ada" }),
    client.execute,
    Effect.flatMap(HttpClientResponse.schemaJson(Echo)),
  )
  yield* Console.log(`POST body: ${created.body}`)

  // filterStatusOk turns non-2xx responses into typed errors.
  const failed = yield* client.get("https://api.example.com/status/503").pipe(
    Effect.flatMap(HttpClientResponse.filterStatusOk),
    Effect.isFailure,
  )
  yield* Console.log(`status 503 failed: ${failed}`)

  // Retry transient failures with a schedule.
  const attempts = yield* Ref.make(0)
  yield* client.get("https://api.example.com/status/503").pipe(
    Effect.tap(() => Ref.update(attempts, (n) => n + 1)),
    Effect.flatMap(HttpClientResponse.filterStatusOk),
    Effect.retry(Schedule.recurs(2)),
    Effect.ignore,
  )
  yield* Console.log(`retried ${yield* Ref.get(attempts)} times`)
}).pipe(Effect.provide(FetchHttpClient.layer))

export default script(program)
