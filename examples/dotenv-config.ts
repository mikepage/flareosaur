/**
 * @title Read configuration from .env text
 * @difficulty beginner
 * @tags workers, config
 * @group Standard library
 * @resource {https://jsr.io/@std/dotenv} @std/dotenv
 * @resource {https://developers.cloudflare.com/workers/configuration/environment-variables/} Workers: environment variables
 * @bindings var:LOG_LEVEL=debug
 * @check GET / -> 200 "url: https://api.example.com/v2" "timeout: 5s" "retries: 3" "log level: debug" "invalid key ignored: true" "back to text:" "RETRIES=3"
 *
 * Workers have no filesystem to load a `.env` file from, but .env text can
 * still be a config source: bundled with the Worker, stored in KV, or kept
 * in a test. std's `parse` reads it into an object, with variable
 * expansion (`${BASE}/v2`). Spread the Worker's own variables over it so
 * the deployed values win.
 */

import { parse, stringify } from "@mikepage/flareosaur/dotenv";
import { script } from "./_lib/script.ts";

interface Env {
  LOG_LEVEL: string;
}

const defaults = `
# API settings
BASE=https://api.example.com
API_URL=\${BASE}/v2
TIMEOUT_SECONDS=5
RETRIES=3
LOG_LEVEL=info
`;

export default script((print, env: Env) => {
  // Values from .env text, then the Worker's variables on top. env holds
  // every binding, so pick the variables you mean.
  const config: Record<string, string> = {
    ...parse(defaults),
    LOG_LEVEL: env.LOG_LEVEL,
  };

  // Everything is a string. Convert and check what you use.
  const timeout = Number(config.TIMEOUT_SECONDS);
  const retries = Number.parseInt(config.RETRIES ?? "", 10);
  if (!Number.isFinite(timeout) || !Number.isInteger(retries)) {
    throw new TypeError("TIMEOUT_SECONDS and RETRIES must be numbers");
  }
  print(`url: ${config.API_URL}`);
  print(`timeout: ${timeout}s`);
  print(`retries: ${retries}`);
  print(`log level: ${config.LOG_LEVEL}`);

  // Keys must be identifiers. Anything else is skipped with a warning.
  const parsed = parse("1BAD=value\nGOOD=yes");
  print(`invalid key ignored: ${!("1BAD" in parsed) && parsed.GOOD === "yes"}`);

  // stringify writes an object back to .env text, quoting where needed.
  print(
    `back to text:\n${stringify({ RETRIES: "3", GREETING: "hello world" })}`,
  );
});
