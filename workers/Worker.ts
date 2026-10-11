// Copyright 2026 the flareosaur authors. MIT license.

/**
 * Write a Cloudflare Worker with Effect.
 *
 * {@linkcode make} turns Effect handlers into the Worker's default export:
 * `fetch` (a function returning an Effect, or an `HttpRouter` layer),
 * `scheduled` and `queue`. Handlers can use:
 *
 * - {@linkcode Env}: the Worker's bindings, and {@linkcode binding} to look
 *   one up with a typed error when it is missing
 * - {@linkcode ExecutionContext}: `waitUntil` for work after the response,
 *   also as {@linkcode waitUntil} that takes an Effect
 * - `Config`: string vars and secrets from the environment are read through
 *   `ConfigProvider.fromEnvRecord`, so `Config.String("API_URL")` works
 * - the services of `layer`, built once per isolate with access to `Env`
 *
 * Failures and defects are logged and become a 500 response.
 *
 * ```ts no-assert
 * import { Config, Effect } from "effect"
 * import * as Worker from "@mikepage/flareosaur/workers/worker"
 *
 * export default Worker.make({
 *   fetch: (request) =>
 *     Effect.gen(function*() {
 *       const greeting = yield* Config.String("GREETING").pipe(Config.withDefault("Hello"))
 *       return new Response(`${greeting} from ${new URL(request.url).pathname}`)
 *     }),
 * })
 * ```
 *
 * @module
 */

import { Cause, ConfigProvider, Context, Effect, Layer, ManagedRuntime, Predicate, Result, Schema } from "effect"
import * as HttpRouter from "effect/http/HttpRouter"
import * as HttpServerResponse from "effect/http/HttpServerResponse"

/** The parts of the Workers `ExecutionContext` this module uses. */
export interface ExecutionContextLike {
  waitUntil(promise: Promise<unknown>): void
  passThroughOnException?(): void
}

/** The parts of a Workers `ScheduledController` this module uses. */
export interface ScheduledControllerLike {
  readonly cron: string
  readonly scheduledTime: number
  noRetry?(): void
}

/** The parts of a Queues message this module uses. */
export interface MessageLike<Body = unknown> {
  readonly id: string
  readonly timestamp: Date
  readonly body: Body
  readonly attempts: number
  ack(): void
  retry(options?: { delaySeconds?: number }): void
}

/** The parts of a Queues `MessageBatch` this module uses. */
export interface MessageBatchLike<Body = unknown> {
  readonly queue: string
  readonly messages: ReadonlyArray<MessageLike<Body>>
  ackAll(): void
  retryAll(options?: { delaySeconds?: number }): void
}

const EnvBase: Context.ServiceClass<
  Env,
  "@mikepage/flareosaur/workers/Env",
  Readonly<Record<string, unknown>>
> = Context.Service<Env, Readonly<Record<string, unknown>>>()(
  "@mikepage/flareosaur/workers/Env",
)

/** The Worker's bindings: vars, secrets, KV namespaces, R2 buckets, queues, ... */
export class Env extends EnvBase {}

const ExecutionContextBase: Context.ServiceClass<
  ExecutionContext,
  "@mikepage/flareosaur/workers/ExecutionContext",
  ExecutionContextLike
> = Context.Service<ExecutionContext, ExecutionContextLike>()(
  "@mikepage/flareosaur/workers/ExecutionContext",
)

/** The `ExecutionContext` of the current event. */
export class ExecutionContext extends ExecutionContextBase {}

const MissingBindingErrorBase: Schema.Class<
  MissingBindingError,
  Schema.TaggedStruct<"MissingBindingError", {
    readonly name: Schema.String
    readonly message: Schema.String
  }>,
  Cause.YieldableError
> = Schema.TaggedError<MissingBindingError>()("MissingBindingError", {
  name: Schema.String,
  message: Schema.String,
})

/** A binding the code expects is not configured for the Worker. */
export class MissingBindingError extends MissingBindingErrorBase {}

/**
 * Looks up a binding by name. Pass a guard to check its shape, e.g.
 * `binding("CACHE", Kv.isKVNamespace)`.
 */
export const binding = <A = unknown>(
  name: string,
  guard?: (u: unknown) => u is A,
): Effect.Effect<A, MissingBindingError, Env> =>
  Effect.gen(function*() {
    const value = (yield* Env)[name]
    if (value === undefined || (guard && !guard(value))) {
      return yield* new MissingBindingError({ name, message: `The binding ${name} is not configured` })
    }
    return value as A
  })

/** A `ConfigProvider` over the string vars and secrets of `env`. */
export const configProvider = (env: Readonly<Record<string, unknown>>): ConfigProvider.ConfigProvider =>
  ConfigProvider.fromEnvRecord(
    Object.fromEntries(Object.entries(env).filter(([, v]) => Predicate.isString(v))) as Record<string, string>,
  )

/**
 * Runs `effect` after the response is sent, with `ctx.waitUntil`. It runs
 * with the services of the current event.
 */
export const waitUntil = <A, E, R>(effect: Effect.Effect<A, E, R>): Effect.Effect<void, never, R | ExecutionContext> =>
  Effect.flatMap(Effect.context<R | ExecutionContext>(), (context) =>
    Effect.sync(() => {
      Context.get(context, ExecutionContext).waitUntil(
        Effect.runPromiseWith(context)(effect.pipe(Effect.catchCause((cause) => Effect.logError(cause)))),
      )
    }))

/** The services every handler can use. */
export type Services<R> = R | Env | ExecutionContext

/** The handlers of a Worker. */
export interface Handlers<R, LE> {
  /** Services built once per isolate. They may read `Env`. */
  readonly layer?: Layer.Layer<R, LE, Env> | undefined
  /**
   * Handles HTTP requests: a function returning an Effect of a `Response`, or
   * an `HttpRouter` app layer (routes added with `HttpRouter.add`).
   */
  readonly fetch?:
    | ((request: Request) => Effect.Effect<Response, unknown, Services<R>>)
    | Layer.Layer<never, any, any>
    | undefined
  /** Handles Cron Triggers. */
  readonly scheduled?: ((controller: ScheduledControllerLike) => Effect.Effect<void, unknown, Services<R>>) | undefined
  /** Handles a batch of Queues messages. */
  readonly queue?: ((batch: MessageBatchLike) => Effect.Effect<void, unknown, Services<R>>) | undefined
}

/** The default export of a Worker module. */
export interface WorkerHandler {
  fetch?(request: Request, env: Record<string, unknown>, ctx: ExecutionContextLike): Promise<Response>
  scheduled?(controller: ScheduledControllerLike, env: Record<string, unknown>, ctx: ExecutionContextLike): Promise<void>
  queue?(batch: MessageBatchLike, env: Record<string, unknown>, ctx: ExecutionContextLike): Promise<void>
}

const servicesLayer = <R, LE>(env: Record<string, unknown>, layer: Layer.Layer<R, LE, Env> | undefined) => {
  const envLayer = Layer.merge(Layer.succeed(Env, env), ConfigProvider.layer(configProvider(env)))
  return layer ? Layer.provideMerge(layer, envLayer) : envLayer
}

const internalError = (cause: Cause.Cause<unknown>) =>
  Effect.logError("Unhandled error in Worker", cause).pipe(
    Effect.as(new Response("Internal Server Error", { status: 500 })),
  )

/** Builds the default export of a Worker from Effect handlers. */
export const make = <R = never, LE = never>(handlers: Handlers<R, LE>): WorkerHandler => {
  let runtime: ManagedRuntime.ManagedRuntime<any, any> | undefined
  let router: ((request: Request, context: Context.Context<ExecutionContext>) => Promise<Response>) | undefined
  const runtimeFor = (env: Record<string, unknown>) =>
    (runtime ??= ManagedRuntime.make(servicesLayer(env, handlers.layer) as Layer.Layer<any, any, never>))

  const run = <A>(
    env: Record<string, unknown>,
    ctx: ExecutionContextLike,
    effect: Effect.Effect<A, unknown, any>,
  ): Promise<A> => runtimeFor(env).runPromise(effect.pipe(Effect.provideService(ExecutionContext, ctx)))

  const worker: WorkerHandler = {}
  const fetch = handlers.fetch
  if (fetch && Layer.isLayer(fetch)) {
    // Services are built once per isolate in the runtime, and handed to the
    // routes as request-level dependencies.
    let routerPromise: Promise<NonNullable<typeof router>> | undefined
    const buildRouter = async (env: Record<string, unknown>) => {
      const rt = runtimeFor(env)
      const context = await rt.context()
      const app = (fetch as Layer.Layer<never, any, any>).pipe(HttpRouter.provideRequest(Layer.succeedContext(context)))
      return HttpRouter.toWebHandler(app as Layer.Layer<never, any, any>, {
        memoMap: rt.memoMap,
        disableLogger: true,
        middleware: (effect: Effect.Effect<any, any, any>) =>
          // Typed failures become responses; log defects, which are bugs.
          // The router short-circuits with a response as the defect (e.g. 404).
          Effect.tapCause(effect, (cause) => {
            const defect = Cause.findDefect(cause)
            return Result.isSuccess(defect) && !HttpServerResponse.isHttpServerResponse(defect.success)
              ? Effect.logError("Unhandled defect in route", cause)
              : Effect.void
          }),
      } as any).handler as unknown as NonNullable<typeof router>
    }
    worker.fetch = async (request, env, ctx) => {
      router ??= await (routerPromise ??= buildRouter(env))
      return router(request, Context.make(ExecutionContext, ctx))
    }
  } else if (fetch) {
    const handler = fetch as (request: Request) => Effect.Effect<Response, unknown, Services<R>>
    worker.fetch = (request, env, ctx) =>
      run(env, ctx, Effect.suspend(() => handler(request)).pipe(Effect.catchCause(internalError)))
  }
  if (handlers.scheduled) {
    const scheduled = handlers.scheduled
    worker.scheduled = (controller, env, ctx) => run(env, ctx, Effect.suspend(() => scheduled(controller)))
  }
  if (handlers.queue) {
    const queue = handlers.queue
    worker.queue = (batch, env, ctx) => run(env, ctx, Effect.suspend(() => queue(batch)))
  }
  return worker
}
