/**
 * @title Environment variables and secrets
 * @difficulty beginner
 * @tags workers, config
 * @group Cloudflare runtime
 * @bindings var:APP_NAME=flareosaur, var:MAX_ITEMS=25, var:API_TOKEN=s3cr3t-token
 * @resource {https://developers.cloudflare.com/workers/configuration/environment-variables/} Cloudflare: environment variables
 * @resource {https://effect.website/docs/configuration/} Effect: Config
 * @check GET / -> 200 "app: flareosaur" "max items: 25" "debug: false" "token: <redacted>" !"s3cr3t"
 *
 * Deno reads configuration with `Deno.env.get`. A Worker gets vars and
 * secrets as bindings, and `Worker.make` exposes the string ones to Effect's
 * `Config`: typed (numbers, booleans, durations), with defaults, and with
 * `Config.Redacted` for secrets so they never end up in a log line.
 */

import { Config, Effect, Redacted } from "effect"
import * as Worker from "@mikepage/flareosaur/workers/worker"

// The configuration, declared once and decoded with types.
const AppConfig = Config.all({
  name: Config.String("APP_NAME"),
  maxItems: Config.Int("MAX_ITEMS"),
  debug: Config.Boolean("DEBUG").pipe(Config.withDefault(false)),
  token: Config.Redacted("API_TOKEN"),
})

export default Worker.make({
  fetch: () =>
    Effect.gen(function*() {
      const config = yield* AppConfig
      // Redacted values print as <redacted>; Redacted.value reads the secret.
      void Redacted.value(config.token)
      return new Response([
        `app: ${config.name}`,
        `max items: ${config.maxItems}`,
        `debug: ${config.debug}`,
        `token: ${String(config.token)}`,
      ].join("\n"))
    }),
})
