/**
 * @title Read configuration from .env text
 * @difficulty beginner
 * @tags workers, config
 * @group Standard library
 * @resource {https://effect.website/docs/configuration/} Effect: Config
 * @check GET / -> 200 "url: https://api.example.com/v2" "timeout: 5s" "retries: 3" "parse error: DotenvError"
 *
 * Workers have no filesystem to load a `.env` file from, but .env text can
 * still be a config source: bundled with the Worker, stored in KV, or kept
 * in a test. `Dotenv.layer` turns it into an Effect `ConfigProvider`, with
 * std's variable expansion (`${BASE}/v2`), so `Config` reads from it.
 */

import { Config, Console, Duration, Effect } from "effect"
import * as Dotenv from "@mikepage/flareosaur/dotenv"
import { script } from "./_lib/script.ts"

const env = `
# API settings
BASE=https://api.example.com
API_URL=\${BASE}/v2
TIMEOUT=5 seconds
RETRIES=3
`

const AppConfig = Config.all({
  url: Config.String("API_URL"),
  timeout: Config.Duration("TIMEOUT"),
  retries: Config.Int("RETRIES"),
})

const program = Effect.gen(function*() {
  const config = yield* AppConfig.pipe(Effect.provide(Dotenv.layer(env)))
  yield* Console.log(`url: ${config.url}`)
  yield* Console.log(`timeout: ${Duration.toSeconds(config.timeout)}s`)
  yield* Console.log(`retries: ${config.retries}`)

  // Invalid lines are typed errors, not silent warnings.
  const error = yield* Effect.flip(Dotenv.parse("1BAD=value"))
  yield* Console.log(`parse error: ${error._tag}`)
})

export default script(program)
