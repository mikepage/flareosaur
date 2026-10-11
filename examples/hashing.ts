/**
 * @title Hash data
 * @difficulty beginner
 * @tags workers, crypto
 * @group Cryptography
 * @resource {https://developer.mozilla.org/en-US/docs/Web/API/SubtleCrypto/digest} MDN: SubtleCrypto.digest
 * @resource {https://developers.cloudflare.com/workers/runtime-apis/web-crypto/#constructors} Workers: crypto.DigestStream
 * @resource {https://jsr.io/@std/crypto} @std/crypto
 * @resource {https://jsr.io/@std/encoding} @std/encoding
 * @check GET / -> 200 "SHA-256: ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad" "BLAKE3: 6437b3ac38465133ffb63b75273a8db548c558465d79db03fd359c6cd5bd9d85" "streamed SHA-256 matches: true"
 *
 * Web Crypto covers the SHA family. std's `crypto` adds the rest (BLAKE3,
 * SHA-3, Keccak, MD5, FNV, ...) as WebAssembly that Workers load as a
 * module, and hands SHA back to the platform. For large bodies, Workers have
 * `crypto.DigestStream`: pipe a stream into it and nothing is held in memory.
 */

import { crypto as stdCrypto } from "@mikepage/flareosaur/crypto";
import { encodeHex } from "@mikepage/flareosaur/encoding/hex";
import { script } from "./_lib/script.ts";

export default script(async (print) => {
  const data = new TextEncoder().encode("abc");

  // SHA-256 is built into Web Crypto. The result is an ArrayBuffer; hex
  // encode it to print or store it.
  const sha256 = await crypto.subtle.digest("SHA-256", data);
  print("SHA-256:", encodeHex(sha256));

  // std's crypto has the same interface and more algorithms.
  const blake3 = await stdCrypto.subtle.digest("BLAKE3", data);
  print("BLAKE3:", encodeHex(blake3));

  // Hash a stream chunk by chunk. A request body or an R2 object body works
  // the same way as this small stream of three parts.
  const chunks = new Blob(["a", "b", "c"]).stream();
  const digestStream = new crypto.DigestStream("SHA-256");
  await chunks.pipeTo(digestStream);
  const streamed = await digestStream.digest;
  print(
    "streamed SHA-256 matches:",
    String(encodeHex(streamed) === encodeHex(sha256)),
  );
});
