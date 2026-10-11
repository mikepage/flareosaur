/**
 * @title Cron Triggers
 * @difficulty beginner
 * @tags workers, cron
 * @group Cloudflare
 * @bindings kv:STATE
 * @resource {https://developers.cloudflare.com/workers/configuration/cron-triggers/} Cloudflare: Cron Triggers
 * @resource {https://developers.cloudflare.com/workers/runtime-apis/handlers/scheduled/} Workers: scheduled handler
 * @check scheduled 0 * * * *
 * @check scheduled 0 * * * *
 * @check scheduled 30 3 * * *
 * @check GET / -> 200 "hourly runs: 2" "nightly runs: 1" "last run:"
 *
 * `Deno.cron` registers a function to run on a schedule. On Workers the
 * schedules live in the Worker's configuration (`triggers.crons`), and every
 * trigger calls the `scheduled` handler. `controller.cron` says which
 * expression fired, so one handler can route each schedule to its own job.
 */

interface Env {
  STATE: KVNamespace;
}

// A job: add one to a counter in KV.
async function count(kv: KVNamespace, key: string): Promise<void> {
  const runs = Number(await kv.get(key) ?? "0");
  await kv.put(key, String(runs + 1));
}

export default {
  // In wrangler.jsonc: "triggers": { "crons": ["0 * * * *", "30 3 * * *"] }
  async scheduled(controller, env, ctx) {
    // scheduledTime is when the trigger was due, in milliseconds.
    const at = new Date(controller.scheduledTime).toISOString();
    switch (controller.cron) {
      case "0 * * * *":
        await count(env.STATE, "hourly");
        break;
      case "30 3 * * *":
        await count(env.STATE, "nightly");
        break;
      default:
        console.warn(`no job for ${controller.cron}`);
    }
    // Bookkeeping that the job does not need to wait for goes to
    // ctx.waitUntil. The runtime keeps the invocation alive until it settles.
    ctx.waitUntil(env.STATE.put("last", `${controller.cron} at ${at}`));
  },

  // A page that shows what the jobs did.
  async fetch(_request, env) {
    const [hourly, nightly, last] = await Promise.all([
      env.STATE.get("hourly"),
      env.STATE.get("nightly"),
      env.STATE.get("last"),
    ]);
    return new Response(
      [
        `hourly runs: ${hourly ?? 0}`,
        `nightly runs: ${nightly ?? 0}`,
        `last run: ${last ?? "never"}`,
      ].join("\n"),
    );
  },
} satisfies ExportedHandler<Env>;
