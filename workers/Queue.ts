// Copyright 2026 the flareosaur authors. MIT license.

/**
 * Cloudflare Queues with Schema-typed messages.
 *
 * A {@linkcode Producer} encodes values with a Schema before sending them.
 * {@linkcode consume} decodes each message of a batch with the same Schema
 * and runs a handler per message: a message is acknowledged when its handler
 * succeeds and retried (with an optional delay) when it fails. Messages that
 * do not decode are acknowledged and logged, so a bad payload cannot block
 * the queue.
 *
 * ```ts no-assert
 * import { Effect, Schema } from "effect"
 * import * as Queue from "@mikepage/flareosaur/workers/queue"
 * import * as Worker from "@mikepage/flareosaur/workers/worker"
 *
 * const Job = Schema.Struct({ id: Schema.Int, url: Schema.String })
 * const Jobs = Queue.Producer.of<typeof Job>("Jobs")
 *
 * export default Worker.make({
 *   layer: Queue.layer(Jobs, "JOBS", Job),
 *   fetch: () => Effect.as(Effect.flatMap(Jobs, (jobs) => jobs.send({ id: 1, url: "/" })), new Response("queued")),
 *   queue: Queue.consume(Job, (job) => Effect.log(`processing ${job.id}`)),
 * })
 * ```
 *
 * @module
 */

import { type Cause, Context, Duration, Effect, Layer, Predicate, Schema } from "effect"
import { binding, type Env, type MessageBatchLike, type MissingBindingError } from "./Worker.ts"

/** The parts of a queue producer binding this module uses. */
export interface QueueLike {
  send(body: unknown, options?: { delaySeconds?: number }): Promise<void>
  sendBatch(messages: Iterable<{ body: unknown; delaySeconds?: number }>): Promise<void>
}

/** Checks that a binding looks like a queue producer. */
export const isQueue = (u: unknown): u is QueueLike =>
  Predicate.hasProperty(u, "send") && Predicate.hasProperty(u, "sendBatch")

const QueueErrorBase: Schema.Class<
  QueueError,
  Schema.TaggedStruct<"QueueError", {
    readonly message: Schema.String
    readonly cause: Schema.Defect
  }>,
  Cause.YieldableError
> = Schema.TaggedError<QueueError>()("QueueError", {
  message: Schema.String,
  cause: Schema.Defect(),
})

/** Sending to a queue failed, or a value did not encode. */
export class QueueError extends QueueErrorBase {}

/** Sends values of type `A` to one queue. */
export interface ProducerService<A> {
  readonly send: (value: A, options?: { readonly delay?: Duration.Input }) => Effect.Effect<void, QueueError>
  readonly sendBatch: (values: Iterable<A>) => Effect.Effect<void, QueueError>
}

/** Defines producer services; create a typed key with `Producer.of<typeof Schema>("Jobs")`. */
export const Producer = {
  /** A service key, named `key`, for a producer of the Schema's type. */
  of: <S extends Schema.Top>(key: string): Context.Service<ProducerService<S["Type"]>, ProducerService<S["Type"]>> =>
    Context.Service<ProducerService<S["Type"]>>(key),
}

const delaySeconds = (delay: Duration.Input | undefined) =>
  delay === undefined ? {} : { delaySeconds: Math.round(Duration.toSeconds(Duration.fromInputUnsafe(delay))) }

/** Builds a producer that encodes values with `schema`. */
export const makeProducer = <S extends Schema.Codec<any, any, never, never>>(
  queue: QueueLike,
  schema: S,
): ProducerService<S["Type"]> => {
  const encode = (value: S["Type"]) =>
    Schema.encodeEffect(schema)(value).pipe(
      Effect.mapError((cause) => new QueueError({ message: "Message did not encode", cause })),
    )
  return {
    send: (value, options) =>
      Effect.flatMap(encode(value), (body) =>
        Effect.tryPromise({
          try: () => queue.send(body, delaySeconds(options?.delay)),
          catch: (cause) => new QueueError({ message: "Queue send failed", cause }),
        })),
    sendBatch: (values) =>
      Effect.flatMap(Effect.forEach(Array.from(values), encode), (bodies) =>
        Effect.tryPromise({
          try: () => queue.sendBatch(bodies.map((body) => ({ body }))),
          catch: (cause) => new QueueError({ message: "Queue sendBatch failed", cause }),
        })),
  }
}

/** Provides a producer service for the queue bound as `name`. */
export const layer = <I, S extends Schema.Codec<any, any, never, never>>(
  key: Context.Key<I, ProducerService<S["Type"]>>,
  name: string,
  schema: S,
): Layer.Layer<I, MissingBindingError, Env> =>
  Layer.effect(key, Effect.map(binding(name, isQueue), (queue) => makeProducer(queue, schema)))

/** Options for {@linkcode consume}. */
export interface ConsumeOptions {
  /** How many messages to handle at once. Defaults to 1. */
  readonly concurrency?: number | undefined
  /** Delay before a failed message is delivered again. */
  readonly retryDelay?: Duration.Input | undefined
}

/**
 * A `queue` handler: decodes every message with `schema` and runs `handler`
 * on it, acking on success and retrying on failure.
 */
export const consume = <S extends Schema.Codec<any, any, never, never>, E, R>(
  schema: S,
  handler: (value: S["Type"], message: MessageBatchLike["messages"][number]) => Effect.Effect<unknown, E, R>,
  options?: ConsumeOptions,
) =>
(batch: MessageBatchLike): Effect.Effect<void, never, R> =>
  Effect.forEach(
    batch.messages,
    (message) =>
      Schema.decodeUnknownEffect(schema)(message.body).pipe(
        Effect.matchEffect({
          onFailure: (error) =>
            Effect.logWarning(`Dropping message ${message.id} from ${batch.queue}: ${error.message}`).pipe(
              Effect.tap(() => Effect.sync(() => message.ack())),
            ),
          onSuccess: (value) =>
            handler(value, message).pipe(
              Effect.matchCauseEffect({
                onSuccess: () => Effect.sync(() => message.ack()),
                onFailure: (cause) =>
                  Effect.logError(`Message ${message.id} failed, retrying`, cause).pipe(
                    Effect.tap(() => Effect.sync(() => message.retry(delaySeconds(options?.retryDelay)))),
                  ),
              }),
            ),
        }),
      ),
    { concurrency: options?.concurrency ?? 1, discard: true },
  )
