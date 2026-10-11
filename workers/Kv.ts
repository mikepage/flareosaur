// Copyright 2026 the flareosaur authors. MIT license.

/**
 * Workers KV as Effect's `KeyValueStore`.
 *
 * {@linkcode layer} provides `KeyValueStore` from a KV namespace binding, so
 * everything in Effect built on it works on Workers: `KeyValueStore.prefix`,
 * schema-validated stores (`KeyValueStore.toSchemaStore`), and the
 * persistence modules. {@linkcode Kv} adds what is specific to KV:
 * expiration, metadata and listing keys.
 *
 * ```ts no-assert
 * import { Effect } from "effect"
 * import { KeyValueStore } from "effect/persistence"
 * import * as Kv from "@mikepage/flareosaur/workers/kv"
 * import * as Worker from "@mikepage/flareosaur/workers/worker"
 *
 * export default Worker.make({
 *   layer: Kv.layer("CACHE"),
 *   fetch: () =>
 *     Effect.gen(function*() {
 *       const store = yield* KeyValueStore.KeyValueStore
 *       const visits = Number((yield* store.get("visits")) ?? "0") + 1
 *       yield* store.set("visits", String(visits))
 *       return new Response(`visit ${visits}`)
 *     }),
 * })
 * ```
 *
 * @module
 */

import { Context, Effect, Layer, Option, Predicate, Schema } from "effect"
import * as KeyValueStore from "effect/persistence/KeyValueStore"
import { binding, type Env, type MissingBindingError } from "./Worker.ts"

/** The parts of a KV namespace binding this module uses. */
export interface KVNamespaceLike {
  get(key: string, type: "text"): Promise<string | null>
  get(key: string, type: "arrayBuffer"): Promise<ArrayBuffer | null>
  getWithMetadata(key: string, type: "text"): Promise<{ value: string | null; metadata: unknown }>
  put(
    key: string,
    value: string | ArrayBuffer | ArrayBufferView | ReadableStream,
    options?: { expiration?: number; expirationTtl?: number; metadata?: unknown },
  ): Promise<void>
  delete(key: string): Promise<void>
  list(options?: { prefix?: string | null; limit?: number; cursor?: string | null }): Promise<{
    keys: Array<{ name: string; expiration?: number; metadata?: unknown }>
    list_complete: boolean
    cursor?: string
  }>
}

/** Checks that a binding looks like a KV namespace. */
export const isKVNamespace = (u: unknown): u is KVNamespaceLike =>
  Predicate.hasProperty(u, "get") && Predicate.hasProperty(u, "put") && Predicate.hasProperty(u, "list")

/** A KV operation failed. */
export class KvError extends Schema.TaggedError<KvError>()("KvError", {
  method: Schema.String,
  key: Schema.optional(Schema.String),
  message: Schema.String,
  cause: Schema.Defect(),
}) {}

/** One key from {@linkcode Kv.list}. */
export interface KvKey {
  readonly name: string
  readonly expiration: Option.Option<number>
  readonly metadata: Option.Option<unknown>
}

/** Options for {@linkcode Kv.set}. */
export interface SetOptions {
  /** Seconds until the key expires (at least 60). */
  readonly expirationTtl?: number | undefined
  /** Absolute expiry, in seconds since the epoch. */
  readonly expiration?: number | undefined
  /** JSON-serializable metadata stored with the key. */
  readonly metadata?: unknown
}

const tryKv = <A>(method: string, key: string | undefined, f: () => Promise<A>) =>
  Effect.tryPromise({
    try: f,
    catch: (cause) =>
      new KvError({ method, ...(key === undefined ? {} : { key }), message: `KV ${method} failed`, cause }),
  })

/** KV-specific operations, beyond `KeyValueStore`. */
export interface KvService {
  readonly namespace: KVNamespaceLike
  readonly get: (key: string) => Effect.Effect<Option.Option<string>, KvError>
  readonly getWithMetadata: (key: string) => Effect.Effect<Option.Option<{ value: string; metadata: unknown }>, KvError>
  readonly set: (key: string, value: string | Uint8Array, options?: SetOptions) => Effect.Effect<void, KvError>
  readonly remove: (key: string) => Effect.Effect<void, KvError>
  /** Lists keys, following cursors until the listing is complete. */
  readonly list: (options?: { readonly prefix?: string }) => Effect.Effect<Array<KvKey>, KvError>
}

/** The KV namespace service; see {@linkcode KvService}. */
export class Kv extends Context.Service<Kv, KvService>()("@mikepage/flareosaur/workers/Kv") {}

/** Builds the {@linkcode Kv} service for a namespace. */
export const make = (namespace: KVNamespaceLike): KvService => {
  const list = (options?: { readonly prefix?: string }) =>
    Effect.gen(function*() {
      const keys: Array<KvKey> = []
      let cursor: string | undefined
      do {
        const page = yield* tryKv("list", undefined, () => namespace.list({ prefix: options?.prefix ?? null, cursor: cursor ?? null }))
        for (const k of page.keys) {
          keys.push({ name: k.name, expiration: Option.fromNullishOr(k.expiration), metadata: Option.fromNullishOr(k.metadata) })
        }
        cursor = page.list_complete ? undefined : page.cursor
      } while (cursor)
      return keys
    })
  return {
    namespace,
    get: (key) => Effect.map(tryKv("get", key, () => namespace.get(key, "text")), Option.fromNullishOr),
    getWithMetadata: (key) =>
      Effect.map(tryKv("getWithMetadata", key, () => namespace.getWithMetadata(key, "text")), ({ value, metadata }) =>
        value === null ? Option.none() : Option.some({ value, metadata })),
    set: (key, value, options) =>
      tryKv("set", key, () =>
        namespace.put(key, value, {
          ...(options?.expirationTtl === undefined ? {} : { expirationTtl: options.expirationTtl }),
          ...(options?.expiration === undefined ? {} : { expiration: options.expiration }),
          ...(options?.metadata === undefined ? {} : { metadata: options.metadata }),
        })),
    remove: (key) => tryKv("remove", key, () => namespace.delete(key)),
    list,
  }
}

const toStoreError = (error: KvError) =>
  new KeyValueStore.KeyValueStoreError({
    method: error.method,
    ...(error.key === undefined ? {} : { key: error.key }),
    message: error.message,
    cause: error.cause,
  })

/** Effect's `KeyValueStore`, backed by a KV namespace. */
export const makeStore = (namespace: KVNamespaceLike): KeyValueStore.KeyValueStore => {
  const kv = make(namespace)
  return KeyValueStore.make({
    get: (key) => kv.get(key).pipe(Effect.map(Option.getOrUndefined), Effect.mapError(toStoreError)),
    getUint8Array: (key) =>
      tryKv("getUint8Array", key, () => namespace.get(key, "arrayBuffer")).pipe(
        Effect.map((buffer) => (buffer === null ? undefined : new Uint8Array(buffer))),
        Effect.mapError(toStoreError),
      ),
    set: (key, value) => kv.set(key, value).pipe(Effect.mapError(toStoreError)),
    remove: (key) => kv.remove(key).pipe(Effect.mapError(toStoreError)),
    clear: kv.list().pipe(
      Effect.flatMap((keys) => Effect.forEach(keys, (k) => kv.remove(k.name), { concurrency: 10, discard: true })),
      Effect.mapError(toStoreError),
    ),
    size: kv.list().pipe(Effect.map((keys) => keys.length), Effect.mapError(toStoreError)),
  })
}

/**
 * Provides {@linkcode Kv} and `KeyValueStore` from the KV namespace bound as
 * `name`.
 */
export const layer = (name: string): Layer.Layer<Kv | KeyValueStore.KeyValueStore, MissingBindingError, Env> =>
  Layer.effectContext(
    Effect.map(binding(name, isKVNamespace), (namespace) =>
      Context.make(Kv, make(namespace)).pipe(Context.add(KeyValueStore.KeyValueStore, makeStore(namespace)))),
  )
