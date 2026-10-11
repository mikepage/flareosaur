/**
 * @title Compress and decompress data
 * @difficulty beginner
 * @tags workers, streams, encoding
 * @group Data formats
 * @resource {https://developer.mozilla.org/en-US/docs/Web/API/CompressionStream} MDN: CompressionStream
 * @check GET / -> 200 "original: 4240 bytes" "gzip:" "round trip ok: true"
 *
 * Workers implement `CompressionStream` and `DecompressionStream`. Wrapped
 * as Effect `Stream` steps, compression is one more stage in a pipeline,
 * whether the data is a string in memory or a large R2 object.
 */

import { Chunk, Console, Effect, Stream } from "effect"
import { script } from "./_lib/script.ts"

// Pipes a byte stream through a web TransformStream (compression here).
const through = (transform: ReadableWritablePair<Uint8Array, Uint8Array> | CompressionStream | DecompressionStream) =>
<E>(bytes: Stream.Stream<Uint8Array, E>) =>
  Stream.fromReadableStream({
    evaluate: () => Stream.toReadableStream(bytes).pipeThrough(transform as ReadableWritablePair<Uint8Array, Uint8Array>),
    onError: (cause) => cause,
  })

const collect = <E>(stream: Stream.Stream<Uint8Array, E>) =>
  Effect.map(Stream.runCollect(stream), (chunks) => {
    const parts = Chunk.toReadonlyArray(Chunk.fromIterable(chunks))
    const out = new Uint8Array(parts.reduce((n, p) => n + p.length, 0))
    let offset = 0
    for (const p of parts) {
      out.set(p, offset)
      offset += p.length
    }
    return out
  })

const program = Effect.gen(function*() {
  const text = "Effect makes streaming code look like ordinary code. ".repeat(80)
  const original = new TextEncoder().encode(text)
  yield* Console.log(`original: ${original.length} bytes`)

  const gzipped = yield* collect(Stream.make(original).pipe(through(new CompressionStream("gzip"))))
  yield* Console.log(`gzip: ${gzipped.length} bytes`)

  const restored = yield* collect(Stream.make(gzipped).pipe(through(new DecompressionStream("gzip"))))
  yield* Console.log(`round trip ok: ${new TextDecoder().decode(restored) === text}`)
})

export default script(program)
