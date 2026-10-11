/**
 * @title Parse and serialize TOML and YAML
 * @difficulty beginner
 * @tags workers, encoding, config
 * @group Data formats
 * @resource {https://jsr.io/@std/toml} @std/toml
 * @resource {https://jsr.io/@std/yaml} @std/yaml
 * @resource {https://toml.io} TOML
 * @resource {https://yaml.org/spec/1.2.2/} YAML 1.2
 * @check GET / -> 200 "toml: api on port 8080" "yaml: api on port 8080" "as yaml:" "port: 8080" "as toml:" "bad port: RangeError" "bad toml: SyntaxError"
 *
 * Configuration files map to plain objects. std has complete parsers and
 * stringifiers for both: the full TOML spec, and YAML 1.2 with multiple
 * documents and tags. Parsing gives you untyped data, so check the values
 * you rely on.
 */

import * as toml from "@mikepage/flareosaur/toml";
import * as yaml from "@mikepage/flareosaur/yaml";
import { script } from "./_lib/script.ts";

interface Config {
  name: string;
  server: { port: number };
}

// Checks the parsed value and returns it typed.
function toConfig(value: unknown): Config {
  const config = value as Partial<Config> | null;
  if (typeof config?.name !== "string") throw new TypeError("name required");
  const port = config.server?.port;
  if (!Number.isInteger(port) || port! < 1 || port! > 65535) {
    throw new RangeError(`invalid port: ${port}`);
  }
  return { name: config.name, server: { port: port! } };
}

const source = `
name = "api"

[server]
port = 8080
`;

export default script((print) => {
  const fromToml = toConfig(toml.parse(source));
  print(`toml: ${fromToml.name} on port ${fromToml.server.port}`);

  // The same value, through YAML and back.
  const asYaml = yaml.stringify(fromToml);
  const fromYaml = toConfig(yaml.parse(asYaml));
  print(`yaml: ${fromYaml.name} on port ${fromYaml.server.port}`);
  print(`as yaml:\n${asYaml}`);

  // And back to TOML text.
  print(`as toml:\n${toml.stringify({ ...fromYaml })}`);

  // Text that parses but holds a bad value fails the check.
  try {
    toConfig(toml.parse(`name = "x"\n[server]\nport = 99999\n`));
  } catch (error) {
    print(`bad port: ${error instanceof Error ? error.name : error}`);
  }

  // Text that does not parse throws a SyntaxError.
  try {
    toml.parse(`name = `);
  } catch (error) {
    print(`bad toml: ${error instanceof Error ? error.name : error}`);
  }
});
