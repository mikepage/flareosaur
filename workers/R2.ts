// Copyright 2026 the flareosaur authors. MIT license.

/**
 * R2 buckets with Effect: objects as `Stream`s, typed errors, `Option` for
 * missing keys, and listings that follow cursors.
 *
 * R2 is where a Worker keeps files, so this module covers what the Deno
 * examples do with `Deno.readFile`, `Deno.writeFile` and walking
 * directories.
 *
 * ```ts no-assert
 * import { Effect, Option } from "effect"
 * import * as R2 from "@mikepage/flareosaur/workers/r2"
 * import * as Worker from "@mikepage/flareosaur/workers/worker"
 *
 * export default Worker.make({
 *   layer: R2.layer("BUCKET"),
 *   fetch: () =>
 *     Effect.gen(function*() {
 *       const bucket = yield* R2.Bucket
 *       yield* bucket.putText("hello.txt", "Hello, R2!")
 *       const text = yield* bucket.getText("hello.txt")
 *       return new Response(Option.getOrElse(text, () => "missing"))
 *     }),
 * })
 * ```
 *
 * @module
 */

import { Context, Effect, Layer, Option, Predicate, Schema, Stream } from "effect"
import { binding, type Env, type MissingBindingError } from "./Worker.ts"

/** The parts of an R2 object (metadata) this module uses. */
export interface R2ObjectLike {
  readonly key: string
  readonly size: number
  readonly etag: string
  readonly uploaded: Date
  readonly httpMetadata?: { contentType?: string; cacheControl?: string } | undefined
  readonly customMetadata?: Record<string, string> | undefined
}

/** An R2 object with its body. */
export interface R2ObjectBodyLike extends R2ObjectLike {
  readonly body: ReadableStream<Uint8Array>
  text(): Promise<string>
  arrayBuffer(): Promise<ArrayBuffer>
}

/** The parts of an R2 bucket binding this module uses. */
export interface R2BucketLike {
  head(key: string): Promise<R2ObjectLike | null>
  get(key: string): Promise<R2ObjectBodyLike | null>
  put(
    key: string,
    value: string | ArrayBuffer | ArrayBufferView | ReadableStream | Blob | null,
    options?: { httpMetadata?: { contentType?: string; cacheControl?: string }; customMetadata?: Record<string, string> },
  ): Promise<R2ObjectLike | null>
  delete(keys: string | Array<string>): Promise<void>
  list(options?: { prefix?: string; cursor?: string; limit?: number; delimiter?: string }): Promise<{
    objects: Array<R2ObjectLike>
    truncated: boolean
    cursor?: string
    delimitedPrefixes: Array<string>
  }>
}

/** Checks that a binding looks like an R2 bucket. */
export const isR2Bucket = (u: unknown): u is R2BucketLike =>
  Predicate.hasProperty(u, "head") && Predicate.hasProperty(u, "put") && Predicate.hasProperty(u, "list")

/** An R2 operation failed. */
export class R2Error extends Schema.TaggedError<R2Error>()("R2Error", {
  method: Schema.String,
  key: Schema.optional(Schema.String),
  message: Schema.String,
  cause: Schema.Defect(),
}) {}

/** Metadata to store with an object. */
export interface PutOptions {
  readonly contentType?: string | undefined
  readonly cacheControl?: string | undefined
  readonly customMetadata?: Record<string, string> | undefined
}

/** An object read from R2, with its body as a stream. */
export interface StoredObject {
  readonly info: R2ObjectLike
  readonly stream: Stream.Stream<Uint8Array, R2Error>
}

/** Operations on one bucket. */
export interface BucketService {
  readonly bucket: R2BucketLike
  readonly head: (key: string) => Effect.Effect<Option.Option<R2ObjectLike>, R2Error>
  readonly get: (key: string) => Effect.Effect<Option.Option<StoredObject>, R2Error>
  readonly getText: (key: string) => Effect.Effect<Option.Option<string>, R2Error>
  readonly getBytes: (key: string) => Effect.Effect<Option.Option<Uint8Array>, R2Error>
  readonly put: (
    key: string,
    value: string | Uint8Array | ReadableStream<Uint8Array> | Blob,
    options?: PutOptions,
  ) => Effect.Effect<R2ObjectLike, R2Error>
  readonly putText: (key: string, text: string, options?: PutOptions) => Effect.Effect<R2ObjectLike, R2Error>
  /** Writes a stream of chunks as one object. */
  readonly putStream: <E, R>(
    key: string,
    stream: Stream.Stream<Uint8Array, E, R>,
    options?: PutOptions,
  ) => Effect.Effect<R2ObjectLike, R2Error | E, R>
  readonly remove: (...keys: ReadonlyArray<string>) => Effect.Effect<void, R2Error>
  /** Lists objects, following cursors until the listing is complete. */
  readonly list: (options?: { readonly prefix?: string }) => Effect.Effect<Array<R2ObjectLike>, R2Error>
}

/** The bucket service; see {@linkcode BucketService}. */
export class Bucket extends Context.Service<Bucket, BucketService>()("@mikepage/flareosaur/workers/R2/Bucket") {}

const tryR2 = <A>(method: string, key: string | undefined, f: () => Promise<A>) =>
  Effect.tryPromise({
    try: f,
    catch: (cause) =>
      new R2Error({ method, ...(key === undefined ? {} : { key }), message: `R2 ${method} failed`, cause }),
  })

const putOptions = (options?: PutOptions) => ({
  httpMetadata: {
    ...(options?.contentType === undefined ? {} : { contentType: options.contentType }),
    ...(options?.cacheControl === undefined ? {} : { cacheControl: options.cacheControl }),
  },
  ...(options?.customMetadata === undefined ? {} : { customMetadata: options.customMetadata }),
})

/** Builds the {@linkcode Bucket} service for a bucket binding. */
export const make = (bucket: R2BucketLike): BucketService => {
  const put: BucketService["put"] = (key, value, options) =>
    tryR2("put", key, async () => {
      const object = await bucket.put(key, value, putOptions(options))
      if (object === null) throw new Error("precondition failed")
      return object
    })
  return {
    bucket,
    head: (key) => Effect.map(tryR2("head", key, () => bucket.head(key)), Option.fromNullishOr),
    get: (key) =>
      Effect.map(tryR2("get", key, () => bucket.get(key)), (object) =>
        Option.map(Option.fromNullishOr(object), (o) => ({
          info: o,
          stream: Stream.fromReadableStream({
            evaluate: () => o.body,
            onError: (cause) => new R2Error({ method: "get", key, message: "R2 body read failed", cause }),
          }),
        }))),
    getText: (key) =>
      Effect.flatMap(tryR2("get", key, () => bucket.get(key)), (object) =>
        object === null ? Effect.succeedNone : Effect.map(tryR2("text", key, () => object.text()), Option.some)),
    getBytes: (key) =>
      Effect.flatMap(tryR2("get", key, () => bucket.get(key)), (object) =>
        object === null
          ? Effect.succeedNone
          : Effect.map(tryR2("arrayBuffer", key, () => object.arrayBuffer()), (b) => Option.some(new Uint8Array(b)))),
    put,
    putText: (key, text, options) => put(key, text, { contentType: "text/plain; charset=utf-8", ...options }),
    putStream: (key, stream, options) =>
      Effect.flatMap(Stream.runCollect(stream), (chunks) => {
        const parts = Array.from(chunks)
        const size = parts.reduce((n, c) => n + c.length, 0)
        const bytes = new Uint8Array(size)
        let offset = 0
        for (const part of parts) {
          bytes.set(part, offset)
          offset += part.length
        }
        return put(key, bytes, options)
      }),
    remove: (...keys) => tryR2("delete", keys.join(","), () => bucket.delete([...keys])),
    list: (options) =>
      Effect.gen(function*() {
        const objects: Array<R2ObjectLike> = []
        let cursor: string | undefined
        do {
          const page = yield* tryR2("list", undefined, () =>
            bucket.list({ ...(options?.prefix ? { prefix: options.prefix } : {}), ...(cursor ? { cursor } : {}) }))
          objects.push(...page.objects)
          cursor = page.truncated ? page.cursor : undefined
        } while (cursor)
        return objects
      }),
  }
}

/** Provides {@linkcode Bucket} from the R2 bucket bound as `name`. */
export const layer = (name: string): Layer.Layer<Bucket, MissingBindingError, Env> =>
  Layer.effect(Bucket, Effect.map(binding(name, isR2Bucket), make))
