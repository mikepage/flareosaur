// Copyright 2026 the flareosaur authors. MIT license.
import { Config, Effect, Layer, Option, Schema, Stream } from "effect"
import * as KeyValueStore from "effect/persistence/KeyValueStore"
import * as HttpRouter from "effect/http/HttpRouter"
import * as HttpServerResponse from "effect/http/HttpServerResponse"
import { describe, it } from "../testing/mod.ts"
import { assertEquals, assertFailsWithTag } from "../assert/mod.ts"
import * as DurableObject from "./DurableObject.ts"
import * as Kv from "./Kv.ts"
import * as Queue from "./Queue.ts"
import * as R2 from "./R2.ts"
import * as Scheduled from "./Scheduled.ts"
import * as Worker from "./Worker.ts"

const fakeKv = (): Kv.KVNamespaceLike => {
  const data = new Map<string, { value: string | Uint8Array; metadata?: unknown }>()
  const text = (v: string | Uint8Array) => typeof v === "string" ? v : new TextDecoder().decode(v)
  return {
    get: (async (key: string, type: "text" | "arrayBuffer") => {
      const entry = data.get(key)
      if (!entry) return null
      return type === "text" ? text(entry.value) : new TextEncoder().encode(text(entry.value)).buffer
    }) as Kv.KVNamespaceLike["get"],
    getWithMetadata: async (key) => {
      const entry = data.get(key)
      return { value: entry ? text(entry.value) : null, metadata: entry?.metadata ?? null }
    },
    put: async (key, value, options) => {
      data.set(key, { value: value as string, metadata: options?.metadata })
    },
    delete: async (key) => {
      data.delete(key)
    },
    list: async (options) => {
      const names = [...data.keys()].filter((k) => !options?.prefix || k.startsWith(options.prefix)).sort()
      const start = Number(options?.cursor ?? 0)
      const page = names.slice(start, start + 2)
      const done = start + 2 >= names.length
      return { keys: page.map((name) => ({ name })), list_complete: done, ...(done ? {} : { cursor: String(start + 2) }) }
    },
  }
}

const ctx: Worker.ExecutionContextLike = { waitUntil: () => {} }

describe("Worker", () => {
  it.live("runs a fetch handler with Env and Config", () =>
    Effect.gen(function*() {
      const worker = Worker.make({
        fetch: (request) =>
          Effect.gen(function*() {
            const greeting = yield* Config.String("GREETING")
            const name = yield* Worker.binding<string>("NAME")
            return new Response(`${greeting}, ${name} at ${new URL(request.url).pathname}`)
          }),
      })
      const response = yield* Effect.promise(() =>
        worker.fetch!(new Request("http://x/hi"), { GREETING: "Hello", NAME: "Ada" }, ctx)
      )
      assertEquals(yield* Effect.promise(() => response.text()), "Hello, Ada at /hi")
    }))

  it.live("turns failures into a 500", () =>
    Effect.gen(function*() {
      const worker = Worker.make({ fetch: () => Effect.fail("boom") })
      const response = yield* Effect.promise(() => worker.fetch!(new Request("http://x/"), {}, ctx))
      assertEquals(response.status, 500)
    }))

  it.live("serves an HttpRouter app", () =>
    Effect.gen(function*() {
      const worker = Worker.make({
        fetch: HttpRouter.add("GET", "/hello/:name", Effect.map(HttpRouter.params, (p) => HttpServerResponse.text(`hi ${p.name}`))),
      })
      const response = yield* Effect.promise(() => worker.fetch!(new Request("http://x/hello/bob"), {}, ctx))
      assertEquals(yield* Effect.promise(() => response.text()), "hi bob")
    }))

  const failingBody = () =>
    new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(new TextEncoder().encode("<html>"))
        controller.error(new Error("boom mid-stream"))
      },
    })

  it.live("buffers bodies so a failing stream becomes a 500", () =>
    Effect.gen(function*() {
      const worker = Worker.make({ buffer: true, fetch: () => Effect.succeed(new Response(failingBody())) })
      const response = yield* Effect.promise(() => worker.fetch!(new Request("http://x/"), {}, ctx))
      assertEquals(response.status, 500)
      const ok = Worker.make({ buffer: true, fetch: () => Effect.succeed(new Response("hi", { status: 201 })) })
      const okResponse = yield* Effect.promise(() => ok.fetch!(new Request("http://x/"), {}, ctx))
      assertEquals([okResponse.status, yield* Effect.promise(() => okResponse.text())], [201, "hi"])
    }))

  it.live("buffers only the responses the predicate picks", () =>
    Effect.gen(function*() {
      const worker = Worker.make({
        buffer: (request) => new URL(request.url).pathname !== "/stream",
        fetch: () => Effect.succeed(new Response(failingBody())),
      })
      const buffered = yield* Effect.promise(() => worker.fetch!(new Request("http://x/page"), {}, ctx))
      assertEquals(buffered.status, 500)
      const streamed = yield* Effect.promise(() => worker.fetch!(new Request("http://x/stream"), {}, ctx))
      assertEquals(streamed.status, 200)
      yield* Effect.promise(() => streamed.body!.cancel().catch(() => {}))
    }))

  it.live("buffers HttpRouter responses", () =>
    Effect.gen(function*() {
      const worker = Worker.make({
        buffer: true,
        fetch: HttpRouter.add(
          "GET",
          "/",
          Effect.succeed(HttpServerResponse.stream(Stream.concat(Stream.make(new Uint8Array([1])), Stream.fail("boom")))),
        ),
      })
      const response = yield* Effect.promise(() => worker.fetch!(new Request("http://x/"), {}, ctx))
      assertEquals(response.status, 500)
    }))

  it.effect("reports a missing binding", () =>
    Effect.gen(function*() {
      const error = yield* assertFailsWithTag(
        Worker.binding("NOPE").pipe(Effect.provideService(Worker.Env, {})),
        "MissingBindingError",
      )
      assertEquals(error.name, "NOPE")
    }))
})

describe("Kv", () => {
  const layer = Kv.layer("CACHE").pipe(Layer.provide(Layer.succeed(Worker.Env, { CACHE: fakeKv() })))

  it.effect("is a KeyValueStore", () =>
    Effect.gen(function*() {
      const store = yield* KeyValueStore.KeyValueStore
      yield* store.set("a", "1")
      yield* store.set("b", "2")
      yield* store.set("c", "3")
      assertEquals(yield* store.get("a"), "1")
      assertEquals(yield* store.size, 3)
      yield* store.remove("a")
      assertEquals(yield* store.has("a"), false)
      yield* store.clear
      assertEquals(yield* store.isEmpty, true)
    }).pipe(Effect.provide(layer)))

  it.effect("lists keys across pages and keeps metadata", () =>
    Effect.gen(function*() {
      const kv = yield* Kv.Kv
      for (const k of ["user:1", "user:2", "user:3", "other"]) yield* kv.set(k, k, { metadata: { k } })
      const keys = yield* kv.list({ prefix: "user:" })
      assertEquals(keys.map((k) => k.name), ["user:1", "user:2", "user:3"])
      const entry = yield* kv.getWithMetadata("user:2")
      assertEquals(Option.map(entry, (e) => e.metadata), Option.some({ k: "user:2" }))
      assertEquals(yield* kv.get("missing"), Option.none())
    }).pipe(Effect.provide(layer)))
})

describe("R2", () => {
  const fakeBucket = (): R2.R2BucketLike => {
    const objects = new Map<string, { bytes: Uint8Array; info: R2.R2ObjectLike }>()
    const toBytes = async (value: unknown) =>
      typeof value === "string"
        ? new TextEncoder().encode(value)
        : value instanceof Uint8Array
        ? value
        : new Uint8Array(await new Response(value as ReadableStream).arrayBuffer())
    return {
      head: async (key) => objects.get(key)?.info ?? null,
      get: async (key) => {
        const o = objects.get(key)
        if (!o) return null
        return {
          ...o.info,
          body: new Response(o.bytes as Uint8Array<ArrayBuffer>).body!,
          text: async () => new TextDecoder().decode(o.bytes),
          arrayBuffer: async () => o.bytes.slice().buffer,
        }
      },
      put: async (key, value, options) => {
        const bytes = await toBytes(value)
        const info = { key, size: bytes.length, etag: String(bytes.length), uploaded: new Date(0), httpMetadata: options?.httpMetadata }
        objects.set(key, { bytes, info })
        return info
      },
      delete: async (keys) => {
        for (const k of Array.isArray(keys) ? keys : [keys]) objects.delete(k)
      },
      list: async (options) => ({
        objects: [...objects.values()].map((o) => o.info).filter((i) => !options?.prefix || i.key.startsWith(options.prefix)),
        truncated: false,
        delimitedPrefixes: [],
      }),
    }
  }
  const layer = R2.layer("BUCKET").pipe(Layer.provide(Layer.succeed(Worker.Env, { BUCKET: fakeBucket() })))

  it.effect("writes and reads objects", () =>
    Effect.gen(function*() {
      const bucket = yield* R2.Bucket
      const info = yield* bucket.putText("notes/a.txt", "hello")
      assertEquals(info.httpMetadata?.contentType, "text/plain; charset=utf-8")
      assertEquals(yield* bucket.getText("notes/a.txt"), Option.some("hello"))
      yield* bucket.putStream("notes/b.bin", Stream.make(new Uint8Array([1, 2]), new Uint8Array([3])))
      assertEquals(Option.map(yield* bucket.getBytes("notes/b.bin"), (b) => Array.from(b)), Option.some([1, 2, 3]))
      assertEquals((yield* bucket.list({ prefix: "notes/" })).map((o) => o.key), ["notes/a.txt", "notes/b.bin"])
      yield* bucket.remove("notes/a.txt")
      assertEquals(yield* bucket.head("notes/a.txt"), Option.none())
    }).pipe(Effect.provide(layer)))
})

describe("Queue", () => {
  const Job = Schema.Struct({ id: Schema.Int })
  const Jobs = Queue.Producer.of<typeof Job>("test/Jobs")

  it.effect("sends encoded messages", () =>
    Effect.gen(function*() {
      const sent: Array<unknown> = []
      const queue: Queue.QueueLike = {
        send: async (body) => {
          sent.push(body)
        },
        sendBatch: async (messages) => {
          for (const m of messages) sent.push(m.body)
        },
      }
      const jobs = Queue.makeProducer(queue, Job)
      yield* jobs.send({ id: 1 })
      yield* jobs.sendBatch([{ id: 2 }, { id: 3 }])
      assertEquals(sent, [{ id: 1 }, { id: 2 }, { id: 3 }])
      void Jobs
    }))

  it.effect("acks handled messages, retries failed ones and drops bad payloads", () =>
    Effect.gen(function*() {
      const outcomes: Array<string> = []
      const message = (id: string, body: unknown): Worker.MessageLike => ({
        id,
        timestamp: new Date(0),
        body,
        attempts: 1,
        ack: () => outcomes.push(`ack ${id}`),
        retry: () => outcomes.push(`retry ${id}`),
      })
      const batch: Worker.MessageBatchLike = {
        queue: "jobs",
        messages: [message("a", { id: 1 }), message("b", { id: 2 }), message("c", { nope: true })],
        ackAll: () => {},
        retryAll: () => {},
      }
      yield* Queue.consume(Job, (job) => job.id === 2 ? Effect.fail("boom") : Effect.void)(batch)
      assertEquals(outcomes, ["ack a", "retry b", "ack c"])
    }))
})

describe("Scheduled", () => {
  it.effect("dispatches by cron expression", () =>
    Effect.gen(function*() {
      const ran: Array<string> = []
      const handler = Scheduled.dispatch({
        "0 * * * *": Effect.sync(() => ran.push("hourly")),
        "0 3 * * *": Effect.sync(() => ran.push("nightly")),
      })
      yield* handler({ cron: "0 3 * * *", scheduledTime: 0 })
      yield* handler({ cron: "5 5 * * *", scheduledTime: 0 })
      assertEquals(ran, ["nightly"])
    }))

  it.effect("computes the next runs", () =>
    Effect.gen(function*() {
      const { DateTime } = yield* Effect.promise(() => import("effect"))
      const from = DateTime.makeUnsafe("2026-01-01T00:30:00Z")
      const runs = yield* Scheduled.nextRuns("0 * * * *", 2, from)
      assertEquals(runs.map(DateTime.formatIso), ["2026-01-01T01:00:00.000Z", "2026-01-01T02:00:00.000Z"])
      yield* assertFailsWithTag(Scheduled.nextRuns("not a cron", 1), "CronExpressionError")
    }))
})

describe("DurableObject", () => {
  it.live("runs effects with storage as a KeyValueStore", () =>
    Effect.gen(function*() {
      const map = new Map<string, unknown>()
      const state: DurableObject.DurableObjectStateLike = {
        id: { toString: () => "object-1" },
        storage: {
          get: async (key) => map.get(key) as any,
          put: async (key, value) => {
            map.set(key, value)
          },
          delete: async (key) => map.delete(key),
          deleteAll: async () => map.clear(),
          list: async () => new Map(map) as any,
        },
      }
      const runner = DurableObject.makeRunner(state, {})
      const increment = Effect.gen(function*() {
        const store = yield* KeyValueStore.KeyValueStore
        const next = Number((yield* store.get("count")) ?? "0") + 1
        yield* store.set("count", String(next))
        return next
      })
      assertEquals(yield* Effect.promise(() => runner.run(increment)), 1)
      assertEquals(yield* Effect.promise(() => runner.run(increment)), 2)
      const id = yield* Effect.promise(() => runner.run(Effect.map(Effect.service(DurableObject.State), (s) => s.id.toString())))
      assertEquals(id, "object-1")
      yield* Effect.promise(() => runner.dispose())
    }))
})
