/**
 * @title Errors as problem details
 * @difficulty intermediate
 * @tags workers, http
 * @group HTTP
 * @resource {https://www.rfc-editor.org/rfc/rfc9457} RFC 9457: Problem Details for HTTP APIs
 * @check GET /accounts/1 -> 200 "Ada"
 * @check GET /accounts/2 -> 404 "\"title\":\"Not Found\"" "account 2 does not exist" header:content-type~"application/problem+json"
 * @check POST /accounts/1/withdraw/500 -> 403 "insufficient funds" "\"balance\":100"
 *
 * APIs should report errors in a format clients can rely on. RFC 9457
 * problem details are JSON with `type`, `title`, `status` and `detail`. Fail
 * a handler with a `Problem`, a typed error like any other, and the router
 * turns it into an `application/problem+json` response.
 */

import { Effect, Layer, Schema } from "effect"
import { HttpRouter, HttpServerResponse } from "effect/http"
import * as ProblemDetails from "@mikepage/flareosaur/http/problem-details"
import * as Worker from "@mikepage/flareosaur/workers/worker"

const ACCOUNTS = new Map([[1, { name: "Ada", balance: 100 }]])
const Params = Schema.Struct({ id: Schema.FiniteFromString })

const findAccount = Effect.gen(function*() {
  const { id } = yield* HttpRouter.schemaPathParams(Params).pipe(Effect.orDie)
  const account = ACCOUNTS.get(id)
  // A Problem is a typed error; its status picks the default title.
  if (!account) return yield* ProblemDetails.problem(404, `account ${id} does not exist`)
  return account
})

const withdraw = Effect.gen(function*() {
  const account = yield* findAccount
  const { amount } = yield* HttpRouter.schemaPathParams(Schema.Struct({ amount: Schema.FiniteFromString })).pipe(Effect.orDie)
  if (amount > account.balance) {
    return yield* ProblemDetails.problem(403, "insufficient funds", { balance: account.balance })
  }
  return HttpServerResponse.text("ok")
})

export default Worker.make({
  fetch: Layer.mergeAll(
    HttpRouter.add("GET", "/accounts/:id", Effect.map(findAccount, (a) => HttpServerResponse.jsonUnsafe(a))),
    HttpRouter.add("POST", "/accounts/:id/withdraw/:amount", withdraw),
  ),
})
