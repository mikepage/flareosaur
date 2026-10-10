// Copyright 2018-2026 the Deno authors. MIT license.
// This module is browser compatible.

/**
 * Concatenates multiple `ReadableStream`s into a single ordered
 * `ReadableStream`.
 *
 * Cancelling the resulting stream will cancel all the input streams.
 *
 * @typeParam T The type of the chunks in the streams.
 * @param streams An iterable of `ReadableStream`s to concat.
 * @returns A `ReadableStream` that will emit the concatenated chunks.
 *
 * @example Usage
 * ```ts
 * import { concatReadableStreams } from "@flareosaur/streams/concat-readable-streams";
 * import { assertEquals } from "@flareosaur/assert";
 *
 * const stream1 = ReadableStream.from([1, 2, 3]);
 * const stream2 = ReadableStream.from([4, 5, 6]);
 * const stream3 = ReadableStream.from([7, 8, 9]);
 *
 * assertEquals(
 *   await Array.fromAsync(concatReadableStreams(stream1, stream2, stream3)),
 *   [1, 2, 3, 4, 5, 6, 7, 8, 9],
 * );
 * ```
 */
export function concatReadableStreams<T>(
  ...streams: ReadableStream<T>[]
): ReadableStream<T> {
  let i = 0;
  // The reader stays open between pulls so cancel() can go through it. A
  // stream that is locked by an in-flight pull rejects stream.cancel(), and
  // workerd starts pulling before a synchronous cancel() gets in.
  let reader: ReadableStreamDefaultReader<T> | undefined;
  return new ReadableStream<T>({
    async pull(controller) {
      reader ??= streams[i]!.getReader();
      const { done, value } = await reader.read();
      if (done) {
        reader.releaseLock();
        reader = undefined;
        if (streams.length === ++i) {
          return controller.close();
        }
        return await this.pull!(controller);
      }
      controller.enqueue(value);
    },
    async cancel(reason) {
      const promises = streams.map((stream, index) =>
        index === i && reader ? reader.cancel(reason) : stream.cancel(reason)
      );
      await Promise.allSettled(promises);
    },
  });
}
