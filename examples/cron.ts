/**
 * @title Cron Triggers
 * @difficulty beginner
 * @tags workers, cron
 * @group Cloudflare
 * @bindings kv:STATE
 * @resource {https://developers.cloudflare.com/workers/configuration/cron-triggers/} Cloudflare: Cron Triggers
 * @resource {https://effect.website/docs/scheduling/cron/} Effect: Cron
 * @check scheduled 0 * * * *
 * @check scheduled 0 * * * *
 * @check scheduled 30 3 * * *
 * @check GET / -> 200 "hourly runs: 2" "nightly runs: 1" "next hourly run:"
 *
 * `Deno.cron` registers a function to run on a schedule. On Workers the
 * schedules live in the Worker's configuration (`triggers.crons`) and every
 * trigger calls the `scheduled` handler. `Scheduled.dispatch` routes each
 * trigger to the effect registered for its expression, and checks the
 * expressions with Effect's `Cron` parser when the Worker loads.
 */

import { DateTime, Effect } from "effect"
import * as KeyValueStore from "effect/persistence/KeyValueStore"
import * as Kv from "@mikepage/flareosaur/workers/kv"
import * as Scheduled from "@mikepage/flareosaur/workers/scheduled"
import * as Worker from "@mikepage/flareosaur/workers/worker"

const count = (key: string) =>
  Effect.gen(function*() {
    const store = yield* KeyValueStore.KeyValueStore
    yield* store.set(key, String(Number((yield* store.get(key)) ?? "0") + 1))
  })

export default Worker.make({
  layer: Kv.layer("STATE"),

  // In wrangler.jsonc: "triggers": { "crons": ["0 * * * *", "30 3 * * *"] }
  scheduled: Scheduled.dispatch({
    "0 * * * *": count("hourly"),
    "30 3 * * *": count("nightly"),
  }),

  fetch: () =>
    Effect.gen(function*() {
      const store = yield* KeyValueStore.KeyValueStore
      const [next] = yield* Scheduled.nextRuns("0 * * * *", 1)
      return new Response([
        `hourly runs: ${(yield* store.get("hourly")) ?? 0}`,
        `nightly runs: ${(yield* store.get("nightly")) ?? 0}`,
        `next hourly run: ${DateTime.formatIso(next!)}`,
      ].join("\n"))
    }),
})
