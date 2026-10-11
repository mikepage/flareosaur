// Copyright 2026 the flareosaur authors. MIT license.
import { Effect, Exit, Fiber, Option, Result, Schema, Stream } from "effect"
import { describe, it } from "../testing/mod.ts"
import {
  assert,
  assertDies,
  assertEquals,
  assertFailsWithTag,
  assertFailure,
  assertFalse,
  assertInstanceOf,
} from "../assert/mod.ts"
import * as Streams from "./mod.ts"

const encoder = new TextEncoder()
const enc = (text: string): Uint8Array => encoder.encode(text)
const dec = (bytes: Uint8Array): string => new TextDecoder().decode(bytes)
const bytes = (...values: Array<number>) => Uint8Array.from(values)
const readableOf = <A>(values: ReadonlyArray<A>): ReadableStream<A> =>
  new ReadableStream<A>({
    start(controller) {
      for (const value of values) controller.enqueue(value)
      controller.close()
    },
  })

describe("fromReadableStream", () => {
  it.effect("reads a ReadableStream", () =>
    Effect.gen(function*() {
      assertEquals(yield* Stream.runCollect(Streams.fromReadableStream(readableOf([1, 2, 3]))), [1, 2, 3])
    }))

  it.effect("fails with a StreamError when the read fails", () =>
    Effect.gen(function*() {
      const readable = new ReadableStream({
        pull(controller) {
          controller.error(new Error("boom"))
        },
      })
      const error = yield* assertFailsWithTag(Stream.runCollect(Streams.fromReadableStream(readable)), "StreamError")
      assertEquals(error.message, "boom")
    }))

  it.effect("cancels the ReadableStream when the Stream ends early", () =>
    Effect.gen(function*() {
      let cancelled = false
      let n = 0
      const readable = new ReadableStream<number>({
        pull(controller) {
          controller.enqueue(n++)
        },
        cancel() {
          cancelled = true
        },
      })
      assertEquals(yield* Stream.runCollect(Stream.take(Streams.fromReadableStream(readable), 2)), [0, 1])
      assert(cancelled)
    }))

  it.effect("fromInput passes Streams through", () =>
    Effect.gen(function*() {
      assertEquals(yield* Stream.runCollect(Streams.fromInput(Stream.make(1))), [1])
      assertEquals(yield* Stream.runCollect(Streams.fromInput(readableOf([2]))), [2])
    }))
})

describe("toReadableStream", () => {
  it.effect("runs a Stream as a ReadableStream", () =>
    Effect.gen(function*() {
      const readable = Streams.toReadableStream(Stream.make("a", "b"))
      assertEquals(yield* Streams.toText(readable), "ab")
    }))
})

describe("toByteStream", () => {
  it.live("supports BYOB readers", () =>
    Effect.promise(async () => {
      const readable = Streams.toByteStream(Stream.make(bytes(1, 2, 3, 4, 5), bytes(), bytes(6)))
      const reader = readable.getReader({ mode: "byob" })
      const first = await reader.read(new Uint8Array(2))
      assertEquals(first.value, bytes(1, 2))
      const second = await reader.read(new Uint8Array(8))
      assertEquals(second.value, bytes(3, 4, 5))
      const third = await reader.read(new Uint8Array(8))
      assertEquals(third.value, bytes(6))
      const end = await reader.read(new Uint8Array(8))
      assert(end.done)
    }))

  it.effect("reads with a default reader", () =>
    Effect.gen(function*() {
      const source = bytes(1, 2, 3)
      const out = yield* Streams.toBytes(Streams.toByteStream(Stream.make(source, bytes(4))))
      assertEquals(out, bytes(1, 2, 3, 4))
      assertEquals(source, bytes(1, 2, 3))
    }))
})

describe("toTransformStream", () => {
  it.effect("applies a Stream transformation in pipeThrough", () =>
    Effect.gen(function*() {
      const readable = readableOf([1, 2, 3]).pipeThrough(
        Streams.toTransformStream((input: Stream.Stream<number, Streams.StreamError>) =>
          input.pipe(Stream.map((n) => n * 2), Stream.filter((n) => n !== 4))
        ),
      )
      assertEquals(yield* Stream.runCollect(Streams.fromReadableStream(readable)), [2, 6])
    }))

  it.effect("errors the readable side when the transformation fails", () =>
    Effect.gen(function*() {
      const readable = readableOf([1]).pipeThrough(
        Streams.toTransformStream((input: Stream.Stream<number, Streams.StreamError>) =>
          Stream.flatMap(input, () => Stream.fail(new Error("nope")))
        ),
      )
      const error = yield* assertFailsWithTag(Stream.runCollect(Streams.fromReadableStream(readable)), "StreamError")
      assertEquals(error.message, "nope")
    }))
})

describe("throughTransformStream", () => {
  it.effect("pipes through Web TransformStreams", () =>
    Effect.gen(function*() {
      const text = "hello ".repeat(100)
      const roundTrip = Stream.make(enc(text)).pipe(
        Streams.throughTransformStream(() => new CompressionStream("gzip") as unknown as TransformStream<Uint8Array, Uint8Array>),
        Streams.throughTransformStream(() => new DecompressionStream("gzip") as unknown as TransformStream<Uint8Array, Uint8Array>),
      )
      assertEquals(yield* Streams.toText(roundTrip), text)
      const decoded = Stream.make(enc("ab")).pipe(
        Streams.throughTransformStream(() => new TextDecoderStream() as unknown as TransformStream<Uint8Array, string>),
      )
      assertEquals(yield* Streams.toText(decoded), "ab")
    }))

  it.effect("fails with a StreamError when the transform errors", () =>
    Effect.gen(function*() {
      const failing = Stream.make(1).pipe(
        Streams.throughTransformStream(() =>
          new TransformStream<number, number>({
            transform() {
              throw new Error("bad chunk")
            },
          })
        ),
      )
      yield* assertFailsWithTag(Stream.runCollect(failing), "StreamError")
    }))
})

describe("collectors", () => {
  it.effect("toText collects strings and UTF-8 bytes", () =>
    Effect.gen(function*() {
      assertEquals(yield* Streams.toText(Stream.make("hello", " ", "world")), "hello world")
      const euro = enc("€")
      assertEquals(yield* Streams.toText(Stream.make(euro.subarray(0, 1), euro.subarray(1), enc("!"))), "€!")
      assertEquals(yield* Streams.toText(new Response("from a body").body!), "from a body")
      assertEquals(yield* Streams.toText(Stream.empty), "")
    }))

  it.effect("toBytes and toArrayBuffer", () =>
    Effect.gen(function*() {
      assertEquals(yield* Streams.toBytes(Stream.make(bytes(1, 2), bytes(3))), bytes(1, 2, 3))
      assertEquals(yield* Streams.toBytes(readableOf([bytes(4), bytes(5)])), bytes(4, 5))
      const buffer = yield* Streams.toArrayBuffer(Stream.make(bytes(1), bytes(2, 3)))
      assertInstanceOf(buffer, ArrayBuffer)
      assertEquals(new Uint8Array(buffer), bytes(1, 2, 3))
    }))

  it.effect("toBlob", () =>
    Effect.gen(function*() {
      const blob = yield* Streams.toBlob(Stream.make(enc("a"), enc("b")), { type: "text/plain" })
      assertEquals(blob.type, "text/plain")
      assertEquals(yield* Effect.promise(() => blob.text()), "ab")
      const piped = yield* Streams.toBlob(readableOf([bytes(1, 2)]))
      assertEquals(piped.size, 2)
    }))

  it.effect("toJson parses, with or without a Schema", () =>
    Effect.gen(function*() {
      assertEquals(yield* Streams.toJson(Stream.make('{"a":', "[1, 2]}")), { a: [1, 2] })
      const User = Schema.Struct({ name: Schema.String, age: Schema.Number })
      const user = yield* Streams.toJson(new Response('{"name":"ada","age":36}').body!, User)
      assertEquals(user, { name: "ada", age: 36 })
      assertEquals(yield* Streams.toJson(Stream.make(enc("[1]")), Schema.Array(Schema.Number)), [1])
      assertEquals(yield* Stream.make("2").pipe(Streams.toJson), 2)
      yield* assertFailsWithTag(Streams.toJson(Stream.make("{")), "SchemaError")
      yield* assertFailsWithTag(Streams.toJson(Stream.make('{"name":1}'), User), "SchemaError")
    }))
})

describe("lines", () => {
  const input = [
    "qwertzu",
    "iopasd\r\nmnbvc",
    "xylk\rjhgfds\napoiuzt\r",
    "qwr\r09ei\rqwrjiowqr\r",
    "\nrewq0987\n\n654321",
    "\nrewq0987\r\n\r\n654321\r",
  ]

  it.effect("splits at \\n and \\r\\n", () =>
    Effect.gen(function*() {
      assertEquals(yield* Stream.runCollect(Streams.lines(Stream.fromIterable(input))), [
        "qwertzuiopasd",
        "mnbvcxylk\rjhgfds",
        "apoiuzt\rqwr\r09ei\rqwrjiowqr",
        "rewq0987",
        "",
        "654321",
        "rewq0987",
        "",
        "654321\r",
      ])
      assertEquals(yield* Stream.runCollect(Streams.lines(Stream.make("rewq0987\r\n\r\n654321\n"))), [
        "rewq0987",
        "",
        "654321",
      ])
    }))

  it.effect("also splits at a lone \\r with allowCR", () =>
    Effect.gen(function*() {
      assertEquals(yield* Stream.fromIterable(input).pipe(Streams.lines({ allowCR: true }), Stream.runCollect), [
        "qwertzuiopasd",
        "mnbvcxylk",
        "jhgfds",
        "apoiuzt",
        "qwr",
        "09ei",
        "qwrjiowqr",
        "rewq0987",
        "",
        "654321",
        "rewq0987",
        "",
        "654321",
      ])
      assertEquals(yield* Stream.make("abc\r", "def").pipe(Streams.lines({ allowCR: true }), Stream.runCollect), [
        "abc",
        "def",
      ])
    }))

  it.effect("handles chunk boundaries, empty chunks and many lines", () =>
    Effect.gen(function*() {
      const chunks = ["abc\n", "def\nghi\njk", "l\nmn", "o\np", "qr", "\nstu\nvwx\n", "yz\n"]
      const expected = ["abc", "def", "ghi", "jkl", "mno", "pqr", "stu", "vwx", "yz"]
      assertEquals(yield* Stream.runCollect(Streams.lines(Stream.fromIterable(chunks))), expected)
      assertEquals(yield* Stream.runCollect(Streams.lines(Stream.make("", "abc\nd", "", "ef", ""))), ["abc", "def"])
      const many = yield* Stream.runCollect(Streams.lines(Stream.make("\n".repeat(20_000))))
      assertEquals(many.length, 20_000)
      const long = "a".repeat(4096)
      const pieces: Array<string> = []
      for (let i = 0; i < long.length; i += 7) pieces.push(long.slice(i, i + 7))
      for (const allowCR of [false, true]) {
        const result = yield* Stream.runCollect(Streams.lines(Stream.fromIterable([...pieces, "\nrest"]), { allowCR }))
        assertEquals(result, [long, "rest"])
      }
    }))

  it.effect("toLines decodes bytes first", () =>
    Effect.gen(function*() {
      const euro = enc("€\r\nb")
      const stream = Stream.make(euro.subarray(0, 2), euro.subarray(2))
      assertEquals(yield* Stream.runCollect(Streams.toLines(stream)), ["€", "b"])
      const body = Streams.fromReadableStream(new Response("x\ry\nz").body!)
      assertEquals(yield* body.pipe(Streams.toLines({ allowCR: true }), Stream.runCollect), ["x", "y", "z"])
    }))
})

describe("delimit", () => {
  const inputs = [
    "a",
    "b",
    "cCRLF",
    "CRLF",
    "qwertzu",
    "iopasdCRLFmnbvc",
    "xylkjhCRLFgfdsapCRLFoiuzt",
    "euoiCRLFCRLFaueiou",
    "rewq098765432CR",
    "LF349012i491290",
    "asdfghjkliopCR",
    "LFytrewqCRLFmnbvcxz",
    "CRLFasd",
  ]
  const run = (chunks: ReadonlyArray<string>, delimiter: string, disposition?: Streams.DelimiterDisposition) =>
    Stream.fromIterable(chunks.map(enc)).pipe(
      Streams.delimit(enc(delimiter), { disposition }),
      Stream.map(dec),
      Stream.runCollect,
    )

  it.effect("discards the delimiter by default", () =>
    Effect.gen(function*() {
      assertEquals(yield* run(inputs, "CRLF"), [
        "abc",
        "",
        "qwertzuiopasd",
        "mnbvcxylkjh",
        "gfdsap",
        "oiuzteuoi",
        "",
        "aueiourewq098765432",
        "349012i491290asdfghjkliop",
        "ytrewq",
        "mnbvcxz",
        "asd",
      ])
    }))

  it.effect("keeps the delimiter as a suffix", () =>
    Effect.gen(function*() {
      assertEquals(yield* run(inputs, "CRLF", "suffix"), [
        "abcCRLF",
        "CRLF",
        "qwertzuiopasdCRLF",
        "mnbvcxylkjhCRLF",
        "gfdsapCRLF",
        "oiuzteuoiCRLF",
        "CRLF",
        "aueiourewq098765432CRLF",
        "349012i491290asdfghjkliopCRLF",
        "ytrewqCRLF",
        "mnbvcxzCRLF",
        "asd",
      ])
    }))

  it.effect("keeps the delimiter as a prefix", () =>
    Effect.gen(function*() {
      assertEquals(yield* run(inputs, "CRLF", "prefix"), [
        "abc",
        "CRLF",
        "CRLFqwertzuiopasd",
        "CRLFmnbvcxylkjh",
        "CRLFgfdsap",
        "CRLFoiuzteuoi",
        "CRLF",
        "CRLFaueiourewq098765432",
        "CRLF349012i491290asdfghjkliop",
        "CRLFytrewq",
        "CRLFmnbvcxz",
        "CRLFasd",
      ])
      assertEquals(yield* run(["CRLF123", "4", "5", "CRLF67890CR", "LF"], "CRLF", "prefix"), [
        "",
        "CRLF12345",
        "CRLF67890",
        "CRLF",
      ])
    }))

  it.effect("splits at a one-byte delimiter", () =>
    Effect.gen(function*() {
      const chars = ["a", "b", "c_", "_", "qwertzu", "iopasd_mnbvc", "xylkjh_gfdsap_oiuzt", "euoi__aueiou", "_asd"]
      assertEquals(yield* run(chars, "_"), [
        "abc",
        "",
        "qwertzuiopasd",
        "mnbvcxylkjh",
        "gfdsap",
        "oiuzteuoi",
        "",
        "aueiou",
        "asd",
      ])
      assertEquals(yield* run(["a_b_"], "_", "suffix"), ["a_", "b_", ""])
    }))

  it.effect("handles partial matches that restart (KMP)", () =>
    Effect.gen(function*() {
      assertEquals(yield* run(["aaab", "aab"], "aab"), ["a", "", ""])
      assertEquals(yield* run(["xabab", "acy"], "abac"), ["xab", "y"])
    }))

  it.effect("dies on an empty delimiter", () =>
    Effect.gen(function*() {
      yield* assertDies(Stream.runCollect(Streams.delimit(Stream.make(bytes(1)), new Uint8Array())))
    }))
})

describe("delimitText", () => {
  const inputs = ["qwertzu", "iopasdfoomnbvc", "xylkjhfoogfdsapfoooiuzt", "euoifoofooaueiou", "rewq098765432fo", "o349012i491290"]
  const run = (disposition?: Streams.DelimiterDisposition) =>
    Stream.fromIterable(inputs).pipe(Streams.delimitText("foo", { disposition }), Stream.runCollect)

  it.effect("discard, suffix and prefix", () =>
    Effect.gen(function*() {
      assertEquals(yield* run(), [
        "qwertzuiopasd",
        "mnbvcxylkjh",
        "gfdsap",
        "oiuzteuoi",
        "",
        "aueiourewq098765432",
        "349012i491290",
      ])
      assertEquals(yield* run("suffix"), [
        "qwertzuiopasdfoo",
        "mnbvcxylkjhfoo",
        "gfdsapfoo",
        "oiuzteuoifoo",
        "foo",
        "aueiourewq098765432foo",
        "349012i491290",
      ])
      assertEquals(yield* run("prefix"), [
        "qwertzuiopasd",
        "foomnbvcxylkjh",
        "foogfdsap",
        "foooiuzteuoi",
        "foo",
        "fooaueiourewq098765432",
        "foo349012i491290",
      ])
    }))

  it.effect("splits JSON lines with an empty line and a trailing newline", () =>
    Effect.gen(function*() {
      const result = yield* Stream.make('{"a":1}\n', "\n", '{"b":2}\n').pipe(Streams.delimitText("\n"), Stream.runCollect)
      assertEquals(result, ['{"a":1}', "", '{"b":2}', ""])
    }))

  it.effect("matches non-ASCII delimiters by code unit", () =>
    Effect.gen(function*() {
      assertEquals(yield* Stream.make("a→→b→", "c").pipe(Streams.delimitText("→"), Stream.runCollect), ["a", "", "b", "c"])
      yield* assertDies(Stream.runCollect(Streams.delimitText(Stream.make("a"), "")))
    }))
})

describe("cappedDelimit", () => {
  const run = (input: Array<number>) =>
    Stream.make(Uint8Array.from(input)).pipe(
      Streams.cappedDelimit({ delimiter: new Uint8Array(2), limit: 5 }),
      Stream.runCollect,
    )

  it.effect("matches and caps", () =>
    Effect.gen(function*() {
      assertEquals(yield* run([0, 0, 1, 1, 1, 0, 0, 0, 0, 5, 5, 5, 5, 5, 2, 3, 3, 4, 6, 0, 0, 2, 3, 3]), [
        { match: true, value: bytes() },
        { match: true, value: bytes(1, 1, 1) },
        { match: true, value: bytes() },
        { match: false, value: bytes(5, 5, 5, 5, 5) },
        { match: true, value: bytes(2, 3, 3, 4, 6) },
        { match: false, value: bytes(2, 3, 3) },
      ])
      assertEquals(yield* run([1, 1, 1, 0, 0, 0, 0, 5, 5, 5, 5, 5, 2, 3, 3, 4, 6, 0, 0, 2, 0, 0, 0, 0]), [
        { match: true, value: bytes(1, 1, 1) },
        { match: true, value: bytes() },
        { match: false, value: bytes(5, 5, 5, 5, 5) },
        { match: true, value: bytes(2, 3, 3, 4, 6) },
        { match: true, value: bytes(2) },
        { match: true, value: bytes() },
      ])
    }))

  it.effect("is independent of chunking", () =>
    Effect.gen(function*() {
      const input = [1, 1, 1, 0, 0, 0, 0, 5, 5, 5, 5, 5, 2, 3, 3, 4, 6, 0, 0, 2, 0, 0, 0, 0]
      const whole = yield* run(input)
      const split = yield* Stream.fromIterable(input.map((n) => bytes(n))).pipe(
        Streams.cappedDelimit({ delimiter: new Uint8Array(2), limit: 5 }),
        Stream.runCollect,
      )
      assertEquals(split, whole)
      const long = yield* Stream.make(bytes(9, 9, 9, 9, 9, 9, 9, 9, 9, 9, 9, 9)).pipe(
        Streams.cappedDelimit({ delimiter: bytes(0), limit: 5 }),
        Stream.runCollect,
      )
      assertEquals(long.map((entry) => entry.value.length), [5, 5, 2])
    }))

  it.effect("dies on invalid options", () =>
    Effect.gen(function*() {
      yield* assertDies(Stream.runCollect(Streams.cappedDelimit(Stream.empty, { delimiter: bytes(0), limit: 0 })))
      yield* assertDies(Stream.runCollect(Streams.cappedDelimit(Stream.empty, { delimiter: bytes(), limit: 1 })))
    }))
})

describe("sliceBytes", () => {
  const run = (start?: number, end?: number) =>
    Stream.make(bytes(0, 1), bytes(2, 3)).pipe(Streams.sliceBytes(start, end), Stream.runCollect)

  it.effect("keeps an inclusive byte range", () =>
    Effect.gen(function*() {
      assertEquals(yield* run(0, 3), [bytes(0, 1), bytes(2, 3)])
      assertEquals(yield* run(0, 1), [bytes(0, 1)])
      assertEquals(yield* run(0, 2), [bytes(0, 1), bytes(2)])
      assertEquals(yield* run(1, 3), [bytes(1), bytes(2, 3)])
      assertEquals(yield* run(2, 3), [bytes(2, 3)])
      assertEquals(yield* run(0, 10), [bytes(0, 1), bytes(2, 3)])
      assertEquals(yield* run(), [bytes(0, 1), bytes(2, 3)])
      assertEquals(yield* run(1, 1), [bytes(1)])
    }))

  it.effect("stops reading after the end", () =>
    Effect.gen(function*() {
      const infinite = Stream.forever(Stream.make(bytes(1, 2, 3)))
      assertEquals(yield* infinite.pipe(Streams.sliceBytes(2, 4), Stream.runCollect), [bytes(3), bytes(1, 2)])
    }))

  it.effect("dies on a negative start", () =>
    Effect.gen(function*() {
      yield* assertDies(run(-1))
    }))
})

describe("fixedChunks", () => {
  it.effect("re-chunks bytes", () =>
    Effect.gen(function*() {
      const out = yield* Stream.make(bytes(1, 2, 3), bytes(4, 5, 6, 7, 8), bytes(9)).pipe(
        Streams.fixedChunks(4),
        Stream.runCollect,
      )
      assertEquals(out, [bytes(1, 2, 3, 4), bytes(5, 6, 7, 8), bytes(9)])
      assertEquals(yield* Stream.runCollect(Streams.fixedChunks(Stream.make(bytes(1, 2)), 2)), [bytes(1, 2)])
      assertEquals(yield* Stream.runCollect(Streams.fixedChunks(Stream.empty, 2)), [])
      yield* assertDies(Stream.runCollect(Streams.fixedChunks(Stream.empty, 0)))
    }))
})

describe("limitBytes", () => {
  const body = Stream.make(bytes(1, 2, 3), bytes(4, 5, 6), bytes(7))

  it.effect("passes streams under the limit", () =>
    Effect.gen(function*() {
      assertEquals(yield* Stream.runCollect(Streams.limitBytes(body, 7)), [bytes(1, 2, 3), bytes(4, 5, 6), bytes(7)])
    }))

  it.effect("fails with LimitExceededError", () =>
    Effect.gen(function*() {
      const error = yield* assertFailsWithTag(Stream.runCollect(body.pipe(Streams.limitBytes(5))), "LimitExceededError")
      assertEquals(error.unit, "bytes")
      assertEquals(error.limit, 5)
    }))

  it.effect("truncates", () =>
    Effect.gen(function*() {
      assertEquals(yield* body.pipe(Streams.limitBytes(5, { onExceeded: "truncate" }), Stream.runCollect), [
        bytes(1, 2, 3),
      ])
    }))
})

describe("limit", () => {
  it.effect("fails or truncates past n elements", () =>
    Effect.gen(function*() {
      assertEquals(yield* Stream.runCollect(Streams.limit(Stream.make(1, 2, 3), 3)), [1, 2, 3])
      const error = yield* assertFailsWithTag(Stream.make(1, 2, 3).pipe(Streams.limit(2), Stream.runCollect), "LimitExceededError")
      assertEquals(error.unit, "elements")
      assertEquals(yield* Stream.make(1, 2, 3).pipe(Streams.limit(2, { onExceeded: "truncate" }), Stream.runCollect), [1, 2])
    }))

  it.effect("emits the elements before failing", () =>
    Effect.gen(function*() {
      const seen: Array<number> = []
      const exit = yield* Stream.make(1, 2, 3).pipe(
        Streams.limit(2),
        Stream.runForEach((n) => Effect.sync(() => seen.push(n))),
        Effect.exit,
      )
      assert(Exit.isFailure(exit))
      assertEquals(seen, [1, 2])
    }))
})

describe("abortable", () => {
  it.effect("fails at once when the signal already aborted", () =>
    Effect.gen(function*() {
      const error = yield* assertFailsWithTag(
        Stream.runCollect(Streams.abortable(Stream.make(1), AbortSignal.abort("why"))),
        "AbortError",
      )
      assertEquals(error.cause, "why")
    }))

  it.effect("fails when the signal aborts", () =>
    Effect.gen(function*() {
      const controller = new AbortController()
      const fiber = yield* Effect.forkChild(Stream.runCollect(Stream.never.pipe(Streams.abortable(controller.signal))))
      yield* Effect.yieldNow
      controller.abort(new Error("stop"))
      const exit = yield* Fiber.await(fiber)
      assert(Exit.isFailure(exit))
      yield* assertFailsWithTag(Fiber.join(fiber), "AbortError")
    }))

  it.effect("passes elements while not aborted", () =>
    Effect.gen(function*() {
      const controller = new AbortController()
      assertEquals(yield* Stream.make(1, 2).pipe(Streams.abortable(controller.signal), Stream.runCollect), [1, 2])
    }))
})

describe("merge", () => {
  it.effect("merges Streams and ReadableStreams", () =>
    Effect.gen(function*() {
      const out = yield* Stream.runCollect(Streams.merge(Stream.make(1, 2), readableOf([3, 4]), Stream.make(5)))
      assertEquals([...out].sort(), [1, 2, 3, 4, 5])
    }))

  it.effect("fails when one input fails", () =>
    Effect.gen(function*() {
      const failing = new ReadableStream({
        pull(controller) {
          controller.error(new Error("x"))
        },
      })
      yield* assertFailsWithTag(Stream.runCollect(Streams.merge(Stream.never, failing)), "StreamError")
    }))
})

describe("concat", () => {
  it.effect("concatenates in order", () =>
    Effect.gen(function*() {
      const out = yield* Stream.runCollect(Streams.concat(Stream.make(1, 2), readableOf([3]), Stream.make(4, 5)))
      assertEquals(out, [1, 2, 3, 4, 5])
      assertEquals(yield* Stream.runCollect(Streams.concat()), [])
    }))
})

describe("interleave", () => {
  it.effect("takes one element from each stream in turn", () =>
    Effect.gen(function*() {
      const out = yield* Stream.runCollect(
        Streams.interleave(
          Stream.fromArrays(["1", "2"], ["3", "4", "5", "6"]),
          readableOf(["a", "b", "c", "d"]),
          Stream.make("x"),
        ),
      )
      assertEquals(out, ["1", "a", "x", "2", "b", "3", "c", "4", "d", "5", "6"])
    }))

  it.effect("earlyInterleave ends with the first stream to end", () =>
    Effect.gen(function*() {
      const out = yield* Stream.runCollect(Streams.earlyInterleave(Stream.make(1, 2, 3), Stream.make("a")))
      assertEquals(out, [1, "a", 2])
      let cancelled = false
      const endless = new ReadableStream<number>({
        pull(controller) {
          controller.enqueue(0)
        },
        cancel() {
          cancelled = true
        },
      })
      assertEquals(yield* Stream.runCollect(Streams.earlyInterleave(endless, Stream.make(7, 8))), [0, 7, 0, 8, 0])
      assert(cancelled)
    }))

  it.effect("propagates failures", () =>
    Effect.gen(function*() {
      const out = Streams.interleave(Stream.make(1), Stream.fail("boom"))
      assertEquals(yield* Effect.flip(Stream.runCollect(out)), "boom")
    }))
})

describe("Buffer", () => {
  it("writes, reads and reports its size", () => {
    const buffer = new Streams.Buffer()
    assert(buffer.empty())
    assert(Result.isSuccess(buffer.write(bytes(1, 2, 3))))
    assert(Result.isSuccess(buffer.write(bytes(4))))
    assertEquals(buffer.length, 4)
    assert(buffer.capacity >= 4)
    assertEquals(buffer.bytes(), bytes(1, 2, 3, 4))
    assertEquals(buffer.read(3), Option.some(bytes(1, 2, 3)))
    assertEquals(buffer.bytes({ copy: false }), bytes(4))
    assertEquals(buffer.read(), Option.some(bytes(4)))
    assertEquals(buffer.read(), Option.none())
    assertFalse(Result.isFailure(buffer.grow(10)))
    assert(buffer.capacity >= 10)
    assertEquals(buffer.length, 0)
  })

  it("starts from existing bytes and grows", () => {
    const buffer = new Streams.Buffer([1, 2])
    for (let i = 0; i < 100; i++) buffer.write(bytes(i))
    assertEquals(buffer.length, 102)
    assertEquals(buffer.bytes().subarray(0, 4), bytes(1, 2, 0, 1))
  })

  it("truncates and resets", () => {
    const buffer = new Streams.Buffer(bytes(1, 2, 3, 4))
    buffer.read(1)
    assert(Result.isSuccess(buffer.truncate(2)))
    assertEquals(buffer.bytes(), bytes(2, 3))
    assertEquals(assertFailure(buffer.truncate(5))._tag, "BufferError")
    assertEquals(assertFailure(buffer.grow(-1))._tag, "BufferError")
    buffer.reset()
    assert(buffer.empty())
    assert(Result.isSuccess(buffer.truncate(0)))
  })

  it.effect("reads and writes as Effect streams", () =>
    Effect.gen(function*() {
      const buffer = new Streams.Buffer()
      yield* Stream.make(enc("hello "), enc("world")).pipe(Stream.run(buffer.sink))
      assertEquals(buffer.length, 11)
      assertEquals(yield* Stream.runCollect(buffer.stream(5)), [enc("hello"), enc(" worl"), enc("d")])
      assert(buffer.empty())
    }))

  it.effect("reads and writes as Web streams", () =>
    Effect.gen(function*() {
      const buffer = new Streams.Buffer()
      yield* Effect.promise(() => readableOf([enc("abc"), enc("def")]).pipeTo(buffer.writable))
      assertEquals(yield* Streams.toText(buffer.readable), "abcdef")
      assert(buffer.empty())
    }))
})
