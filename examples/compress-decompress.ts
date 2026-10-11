/**
 * @title Compress and decompress data
 * @difficulty beginner
 * @tags workers, streams, encoding
 * @group Data formats
 * @resource {https://developer.mozilla.org/en-US/docs/Web/API/CompressionStream} MDN: CompressionStream
 * @resource {https://developer.mozilla.org/en-US/docs/Web/API/DecompressionStream} MDN: DecompressionStream
 * @check GET / -> 200 "original: 4000 bytes" "gzip:" "deflate-raw:" "round trip ok: true"
 *
 * Workers implement `CompressionStream` and `DecompressionStream`. They are
 * `TransformStream`s, so compression is one more `pipeThrough` in a
 * pipeline, whether the data is a string in memory or a large R2 object.
 */

import { script } from "./_lib/script.ts";

// Pipes bytes through a transform and collects the result. A Response can
// wrap any ReadableStream, and its bytes() reads it to the end.
async function transform(
  bytes: Uint8Array,
  stream: CompressionStream | DecompressionStream,
): Promise<Uint8Array> {
  const output = new Response(bytes).body!.pipeThrough(stream);
  return await new Response(output).bytes();
}

export default script(async (print) => {
  const text = "Workers speak the web platform, streams included. ".repeat(
    80,
  );
  const original = new TextEncoder().encode(text);
  print(`original: ${original.length} bytes`);

  // gzip, deflate and deflate-raw are the supported formats.
  const gzipped = await transform(original, new CompressionStream("gzip"));
  print(`gzip: ${gzipped.length} bytes`);
  const raw = await transform(original, new CompressionStream("deflate-raw"));
  print(`deflate-raw: ${raw.length} bytes`);

  // DecompressionStream reverses it.
  const restored = await transform(gzipped, new DecompressionStream("gzip"));
  print(`round trip ok: ${new TextDecoder().decode(restored) === text}`);
});
