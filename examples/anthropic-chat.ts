/**
 * @title Connect to Claude with Effect AI
 * @difficulty beginner
 * @tags workers, ai
 * @group AI
 * @bindings var:ANTHROPIC_API_KEY=sk-ant-test, outbound:anthropic
 * @resource {https://docs.anthropic.com/en/api/messages} Anthropic: Messages API
 * @resource {https://effect.website/docs/ai/introduction/} Effect: AI
 * @check POST /ask h:content-type=application/json {"question":"What is a Durable Object?"} -> 200 "stub reply to: What is a Durable Object?"
 *
 * `effect/ai` gives every provider the same interface: a `LanguageModel`
 * service you call from your code, and a provider layer you choose once.
 * Here the provider is Anthropic, running on the Worker's own `fetch`, with
 * the API key read as a redacted secret. (The check runs against a stand-in
 * for the API; deploy with a real `ANTHROPIC_API_KEY` secret to talk to
 * Claude.)
 */

import { AnthropicClient, AnthropicLanguageModel } from "@effect/ai-anthropic"
import { Config, Effect, Layer, Schema } from "effect"
import { LanguageModel } from "effect/ai"
import { FetchHttpClient, HttpRouter, HttpServerRequest, HttpServerResponse } from "effect/http"
import * as Worker from "@mikepage/flareosaur/workers/worker"

// The provider: Anthropic over fetch, with the key from a Worker secret.
const Claude = AnthropicLanguageModel.layer({ model: "claude-sonnet-5-5" }).pipe(
  Layer.provide(AnthropicClient.layerConfig({ apiKey: Config.Redacted("ANTHROPIC_API_KEY") })),
  Layer.provide(FetchHttpClient.layer),
)

const ask = Effect.gen(function*() {
  const { question } = yield* HttpServerRequest.schemaBodyJson(Schema.Struct({ question: Schema.String }))
  // The handler only knows LanguageModel, not which provider is behind it.
  const response = yield* LanguageModel.generateText({ prompt: question })
  return HttpServerResponse.text(response.text)
}).pipe(Effect.orDie)

export default Worker.make({ layer: Claude, fetch: HttpRouter.add("POST", "/ask", ask) })
