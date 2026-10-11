/**
 * @title Parse and serialize TOML and YAML
 * @difficulty beginner
 * @tags workers, encoding, config
 * @group Encoding
 * @resource {https://toml.io} TOML
 * @resource {https://yaml.org/spec/1.2.2/} YAML 1.2
 * @check GET / -> 200 "toml: api on port 8080" "yaml: api on port 8080" "as yaml:" "port: 8080" "bad port: SchemaError"
 *
 * Configuration files map to typed values with a Schema codec: TOML or
 * YAML text in, a validated config object out, and back again. Both
 * parsers are std's complete implementations (the full TOML spec, YAML 1.2
 * with multiple documents and tags), behind typed errors.
 */

import { Console, Effect, Schema } from "effect"
import * as Toml from "@mikepage/flareosaur/toml"
import * as Yaml from "@mikepage/flareosaur/yaml"
import { script } from "./_lib/script.ts"

const Config = Schema.Struct({
  name: Schema.String,
  server: Schema.Struct({ port: Schema.Int.check(Schema.isBetween({ minimum: 1, maximum: 65535 })) }),
})

const toml = `
name = "api"

[server]
port = 8080
`

const program = Effect.gen(function*() {
  const fromToml = yield* Schema.decodeEffect(Toml.schema(Config))(toml)
  yield* Console.log(`toml: ${fromToml.name} on port ${fromToml.server.port}`)

  // The same value, through YAML.
  const yaml = yield* Yaml.stringify(fromToml)
  const fromYaml = yield* Schema.decodeEffect(Yaml.schema(Config))(yaml)
  yield* Console.log(`yaml: ${fromYaml.name} on port ${fromYaml.server.port}`)
  yield* Console.log(`as yaml:\n${yaml}`)

  // Values that parse but do not fit the schema fail with a SchemaError.
  const bad = yield* Effect.flip(Schema.decodeEffect(Toml.schema(Config))(`name = "x"\n[server]\nport = 99999\n`))
  yield* Console.log(`bad port: ${bad._tag}`)
})

export default script(program)
