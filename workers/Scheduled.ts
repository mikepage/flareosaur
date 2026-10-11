// Copyright 2026 the flareosaur authors. MIT license.

/**
 * Cron Triggers with Effect: {@linkcode dispatch} routes each trigger to the
 * effect registered for its cron expression, the way Deno.cron registers a
 * function per schedule. Expressions are checked with Effect's `Cron`
 * parser, and {@linkcode nextRuns} tells when a schedule fires next.
 *
 * ```ts no-assert
 * import { Effect } from "effect"
 * import * as Scheduled from "@mikepage/flareosaur/workers/scheduled"
 * import * as Worker from "@mikepage/flareosaur/workers/worker"
 *
 * export default Worker.make({
 *   scheduled: Scheduled.dispatch({
 *     "0 * * * *": Effect.log("every hour"),
 *     "0 3 * * *": Effect.log("nightly cleanup"),
 *   }),
 * })
 * ```
 *
 * @module
 */

import { Cron, DateTime, Effect, Result, Schema } from "effect"
import type { ScheduledControllerLike } from "./Worker.ts"

/** A cron expression in `dispatch` does not parse. */
export class CronExpressionError extends Schema.TaggedError<CronExpressionError>()("CronExpressionError", {
  expression: Schema.String,
  message: Schema.String,
}) {}

/** A `scheduled` handler running the effect registered for the trigger's cron expression. */
export const dispatch = <E, R>(schedules: Readonly<Record<string, Effect.Effect<unknown, E, R>>>) => {
  for (const expression of Object.keys(schedules)) {
    const parsed = Cron.parse(expression)
    if (Result.isFailure(parsed)) {
      throw new CronExpressionError({ expression, message: parsed.failure.message })
    }
  }
  return (controller: ScheduledControllerLike): Effect.Effect<void, E, R> => {
    const effect = schedules[controller.cron]
    return effect === undefined
      ? Effect.logWarning(`No handler registered for cron trigger ${controller.cron}`)
      : Effect.asVoid(effect).pipe(Effect.annotateLogs({ cron: controller.cron }))
  }
}

/** The next `count` times a cron expression fires, after `from` (default: now). */
export const nextRuns = (
  expression: string,
  count: number,
  from?: DateTime.DateTime,
): Effect.Effect<Array<DateTime.Utc>, CronExpressionError> =>
  Effect.gen(function*() {
    const parsed = Cron.parse(expression)
    if (Result.isFailure(parsed)) {
      return yield* new CronExpressionError({ expression, message: parsed.failure.message })
    }
    let cursor = from ? DateTime.toDateUtc(from) : DateTime.toDateUtc(yield* DateTime.now)
    const runs: Array<DateTime.Utc> = []
    for (let i = 0; i < count; i++) {
      cursor = Cron.next(parsed.success, cursor)
      runs.push(DateTime.fromDateUnsafe(cursor))
    }
    return runs
  })
