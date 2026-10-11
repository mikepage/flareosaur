// Copyright 2026 the flareosaur authors. MIT license.

/**
 * Durable Objects with Effect.
 *
 * {@linkcode makeRunner} gives a Durable Object class an Effect runtime: its
 * `state` as the {@linkcode State} service, the Worker's bindings as `Env`,
 * its storage as Effect's `KeyValueStore`, and any services of your own
 * layer, built once per object. {@linkcode storageStore} adapts Durable
 * Object storage to `KeyValueStore` on its own.
 *
 * ```ts no-assert
 * import { Effect } from "effect"
 * import { KeyValueStore } from "effect/persistence"
 * import * as DurableObject from "@mikepage/flareosaur/workers/durable-object"
 *
 * export class Counter {
 *   private readonly runner
 *   constructor(state: DurableObject.DurableObjectStateLike, env: Record<string, unknown>) {
 *     this.runner = DurableObject.makeRunner(state, env)
 *   }
 *   fetch() {
 *     return this.runner.run(Effect.gen(function*() {
 *       const store = yield* KeyValueStore.KeyValueStore
 *       const count = Number((yield* store.get("count")) ?? "0") + 1
 *       yield* store.set("count", String(count))
 *       return new Response(String(count))
 *     }))
 *   }
 * }
 * ```
 *
 * @module
 */

import { Cause, Context, Effect, Layer, ManagedRuntime } from "effect"
import * as KeyValueStore from "effect/persistence/KeyValueStore"
import { configProvider, Env } from "./Worker.ts"
import { ConfigProvider } from "effect"

/** The parts of Durable Object storage this module uses. */
export interface DurableObjectStorageLike {
  get<T = unknown>(key: string): Promise<T | undefined>
  put<T>(key: string, value: T): Promise<void>
  delete(key: string): Promise<boolean>
  deleteAll(): Promise<void>
  list<T = unknown>(options?: { prefix?: string }): Promise<Map<string, T>>
}

/** The parts of `DurableObjectState` this module uses. */
export interface DurableObjectStateLike {
  readonly id: { toString(): string }
  readonly storage: DurableObjectStorageLike
  blockConcurrencyWhile?<T>(f: () => Promise<T>): Promise<T>
  acceptWebSocket?(ws: WebSocket, tags?: Array<string>): void
  getWebSockets?(tag?: string): Array<WebSocket>
}

/** The state of the current Durable Object. */
export class State extends Context.Service<State, DurableObjectStateLike>()(
  "@mikepage/flareosaur/workers/DurableObject/State",
) {}

const storageError = (method: string, key: string | undefined, cause: unknown) =>
  new KeyValueStore.KeyValueStoreError({
    method,
    ...(key === undefined ? {} : { key }),
    message: `Durable Object storage ${method} failed`,
    cause,
  })

/** Effect's `KeyValueStore` backed by Durable Object storage. */
export const storageStore = (storage: DurableObjectStorageLike): KeyValueStore.KeyValueStore => {
  const attempt = <A>(method: string, key: string | undefined, f: () => Promise<A>) =>
    Effect.tryPromise({ try: f, catch: (cause) => storageError(method, key, cause) })
  return KeyValueStore.make({
    get: (key) =>
      Effect.map(attempt("get", key, () => storage.get<string | Uint8Array>(key)), (v) =>
        v === undefined ? undefined : typeof v === "string" ? v : new TextDecoder().decode(v)),
    getUint8Array: (key) =>
      Effect.map(attempt("getUint8Array", key, () => storage.get<string | Uint8Array>(key)), (v) =>
        v === undefined ? undefined : typeof v === "string" ? new TextEncoder().encode(v) : v),
    set: (key, value) => attempt("set", key, () => storage.put(key, value)),
    remove: (key) => Effect.asVoid(attempt("remove", key, () => storage.delete(key))),
    clear: attempt("clear", undefined, () => storage.deleteAll()),
    size: Effect.map(attempt("size", undefined, () => storage.list()), (m) => m.size),
  })
}

/** Runs Effects inside a Durable Object. */
export interface Runner<R> {
  readonly run: <A, E>(
    effect: Effect.Effect<A, E, R | State | Env | KeyValueStore.KeyValueStore>,
  ) => Promise<A>
  readonly dispose: () => Promise<void>
}

/**
 * Builds a runner for a Durable Object, with `layer`'s services. Failures
 * are logged and rethrown, so the caller (or the runtime) sees them.
 */
export const makeRunner = <R = never, LE = never>(
  state: DurableObjectStateLike,
  env: Record<string, unknown>,
  layer?: Layer.Layer<R, LE, State | Env | KeyValueStore.KeyValueStore>,
): Runner<R> => {
  const base = Layer.mergeAll(
    Layer.succeed(State, state),
    Layer.succeed(Env, env),
    Layer.succeed(KeyValueStore.KeyValueStore, storageStore(state.storage)),
    ConfigProvider.layer(configProvider(env)),
  )
  const runtime = ManagedRuntime.make((layer ? Layer.provideMerge(layer, base) : base) as Layer.Layer<any, any, never>)
  return {
    run: (effect) =>
      runtime.runPromise(effect.pipe(Effect.tapCause((cause) =>
        Cause.hasInterruptsOnly(cause) ? Effect.void : Effect.logError("Durable Object handler failed", cause)
      ))),
    dispose: () => runtime.dispose(),
  }
}
