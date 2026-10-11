// Copyright 2018-2026 the Deno authors. MIT license.

import { assert } from "../../assert/_std/mod.ts";
import { assertEquals } from "../../assert/_std/mod.ts";
import { toBlob } from "./to_blob.ts";

Deno.test("toBlob()", async () => {
  const stream = ReadableStream.from([
    new Uint8Array([1, 2, 3, 4, 5]),
    new Uint8Array([6, 7]),
    new Uint8Array([8, 9]),
  ]);

  const blob = await toBlob(stream);
  assert(blob instanceof Blob);
  assertEquals(
    await blob.arrayBuffer(),
    new Uint8Array([1, 2, 3, 4, 5, 6, 7, 8, 9]).buffer,
  );
});
