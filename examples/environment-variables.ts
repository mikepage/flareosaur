/**
 * @title Environment variables and secrets
 * @difficulty beginner
 * @tags workers, config
 * @group Cloudflare
 * @bindings var:APP_NAME=flareosaur, var:MAX_ITEMS=25, var:API_TOKEN=s3cr3t-token
 * @resource {https://developers.cloudflare.com/workers/configuration/environment-variables/} Cloudflare: environment variables
 * @resource {https://developers.cloudflare.com/workers/configuration/secrets/} Cloudflare: secrets
 * @check GET / -> 200 "app: flareosaur" "max items: 25" "debug: false" "token: s3c…" !"s3cr3t"
 *
 * Deno reads configuration with `Deno.env.get`. A Worker gets its vars and
 * secrets as bindings on `env`, the second argument of every handler. They
 * arrive as strings (vars set as JSON in wrangler.jsonc keep their type), so
 * parse numbers and booleans yourself, with a default where one makes sense,
 * and keep secrets out of responses and logs.
 */

interface Env {
  // A plain var: "vars": { "APP_NAME": "flareosaur" } in wrangler.jsonc.
  APP_NAME: string;
  MAX_ITEMS: string;
  // Optional: not every environment sets it.
  DEBUG?: string;
  // A secret: `npx wrangler secret put API_TOKEN`. Same shape as a var.
  API_TOKEN: string;
}

// Reads the configuration once per request. env is fixed for the
// deployment, but reading it per request keeps this a pure function.
function config(env: Env) {
  const maxItems = Number.parseInt(env.MAX_ITEMS, 10);
  if (!Number.isInteger(maxItems) || maxItems < 1) {
    throw new Error(
      `MAX_ITEMS must be a positive integer, got ${env.MAX_ITEMS}`,
    );
  }
  return {
    name: env.APP_NAME,
    maxItems,
    debug: env.DEBUG === "true",
    token: env.API_TOKEN,
  };
}

// Shows just enough of a secret to tell which one is set.
const redact = (secret: string) => `${secret.slice(0, 3)}…`;

export default {
  fetch(_request, env) {
    const { name, maxItems, debug, token } = config(env);
    // The token would go into an outgoing request header, never a response.
    return new Response(
      [
        `app: ${name}`,
        `max items: ${maxItems}`,
        `debug: ${debug}`,
        `token: ${redact(token)}`,
      ].join("\n"),
    );
  },
} satisfies ExportedHandler<Env>;
