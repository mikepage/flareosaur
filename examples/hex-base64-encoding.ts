/**
 * @title Hex, base64, base32 and base58 encoding
 * @difficulty beginner
 * @tags workers, encoding
 * @group Data formats
 * @resource {https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Global_Objects/Uint8Array/toBase64} MDN: Uint8Array.prototype.toBase64
 * @resource {https://jsr.io/@std/encoding} @std/encoding
 * @resource {https://www.rfc-editor.org/rfc/rfc4648} RFC 4648: base16, base32, base64
 * @check GET / -> 200 "hex: 48656c6c6f" "base64: SGVsbG8=" "base64url: SGVsbG8" "base32: JBSWY3DP" "base58: 9Ajdvzr" "decoded: Hello" "bad input: SyntaxError" "bad base58: TypeError"
 *
 * Binary data often has to travel as text: in URLs, JSON or headers.
 * Workers have hex and base64 built in, on `Uint8Array` itself. std's
 * encoding module adds base32, base58 and ascii85.
 */

import {
  decodeBase58,
  encodeBase32,
  encodeBase58,
} from "@mikepage/flareosaur/encoding";
import { script } from "./_lib/script.ts";

export default script((print) => {
  const bytes = new TextEncoder().encode("Hello");

  // The web platform: Uint8Array has toHex and toBase64. The base64url
  // alphabet, without padding, is an option.
  print("hex:", bytes.toHex());
  print("base64:", bytes.toBase64());
  print(
    "base64url:",
    bytes.toBase64({ alphabet: "base64url", omitPadding: true }),
  );

  // The static Uint8Array.fromHex and Uint8Array.fromBase64 decode.
  print(
    "decoded:",
    new TextDecoder().decode(Uint8Array.fromBase64("SGVsbG8=")),
  );

  // std's encoders cover the other alphabets. They take bytes or a string.
  print("base32:", encodeBase32(bytes));
  print("base58:", encodeBase58(bytes));
  print("base58 decoded:", new TextDecoder().decode(decodeBase58("9Ajdvzr")));

  // Bad input throws, so decode untrusted text inside try/catch.
  try {
    Uint8Array.fromBase64("not base64!");
  } catch (error) {
    print("bad input:", error instanceof Error ? error.name : String(error));
  }
  try {
    decodeBase58("0OIl");
  } catch (error) {
    print("bad base58:", error instanceof Error ? error.name : String(error));
  }
});
