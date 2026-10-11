/**
 * @title Validate JSON bodies
 * @difficulty beginner
 * @tags workers, http, schema
 * @group HTTP
 * @resource {https://effect.website/docs/schema/introduction/} Effect: Schema
 * @check POST /users h:content-type=application/json {"name":"Ada","email":"ada@example.com","age":36} -> 201 "Ada" "ada@example.com"
 * @check POST /users h:content-type=application/json {"name":"","email":"nope"} -> 400 "Invalid user"
 *
 * Never trust a request body. `HttpServerRequest.schemaBodyJson` parses the
 * body and decodes it with a Schema in one step; a body that does not match
 * fails with a `SchemaError` that says exactly what is wrong.
 */

import { Effect, Schema, SchemaIssue } from "effect"
import { HttpRouter, HttpServerRequest, HttpServerResponse } from "effect/http"
import * as Worker from "@mikepage/flareosaur/workers/worker"

const NewUser = Schema.Struct({
  name: Schema.NonEmptyString,
  email: Schema.String.check(Schema.isPattern(/^[^\s@]+@[^\s@]+$/, { message: "Expected an email address" })),
  age: Schema.optional(Schema.Int.check(Schema.isGreaterThanOrEqualTo(0))),
})

const createUser = Effect.gen(function*() {
  const user = yield* HttpServerRequest.schemaBodyJson(NewUser)
  return HttpServerResponse.jsonUnsafe({ id: crypto.randomUUID(), ...user }, { status: 201 })
}).pipe(
  // Turn decoding failures into a 400 with a readable message.
  Effect.catchTag("SchemaError", (error) =>
    Effect.succeed(
      HttpServerResponse.jsonUnsafe(
        { error: "Invalid user", details: SchemaIssue.makeFormatterDefault()(error.issue) },
        { status: 400 },
      ),
    )),
)

export default Worker.make({ fetch: HttpRouter.add("POST", "/users", createUser) })
