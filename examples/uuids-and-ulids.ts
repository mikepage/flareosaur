/**
 * @title Generate and validate UUIDs and ULIDs
 * @difficulty beginner
 * @tags workers, crypto
 * @group Cryptography
 * @resource {https://developer.mozilla.org/en-US/docs/Web/API/Crypto/randomUUID} MDN: Crypto.randomUUID
 * @resource {https://jsr.io/@std/uuid} @std/uuid
 * @resource {https://jsr.io/@std/ulid} @std/ulid
 * @resource {https://www.rfc-editor.org/rfc/rfc9562} RFC 9562: UUIDs
 * @resource {https://github.com/ulid/spec} ULID spec
 * @check GET / -> 200 "v4 version: 4" "v7 sorts by time: true" "v5 is stable: true" "valid: true" "invalid: false" "ulid decodes to 2026-"
 *
 * UUID v4 is random, and Workers have it built in as `crypto.randomUUID()`.
 * v7 starts with a timestamp, so new ids sort last. v5 is the same for the
 * same name every time. ULIDs are sortable too, in a shorter alphabet. std
 * adds the versions the platform lacks, plus validation. Ids are made inside
 * the handler: Workers forbid randomness in global scope.
 */

import {
  NAMESPACE_URL,
  v5,
  v7,
  validate,
  version,
} from "@mikepage/flareosaur/uuid";
import { decodeTime, ulid } from "@mikepage/flareosaur/ulid";
import { script } from "./_lib/script.ts";

export default script(async (print) => {
  // A random v4 UUID from the platform. No import needed.
  const id = crypto.randomUUID();
  print("v4 version:", String(version(id)));

  // v7 puts the time in milliseconds first. Two ids made a moment apart
  // compare in the order they were made.
  const first = v7.generate();
  await new Promise((resolve) => setTimeout(resolve, 2));
  const second = v7.generate();
  print("v7 sorts by time:", String(first < second));

  // v5 hashes a namespace and a name with SHA-1: the same input gives the
  // same id, which makes it a stable key for a URL.
  const name = new TextEncoder().encode("https://example.com");
  const a = await v5.generate(NAMESPACE_URL, name);
  const b = await v5.generate(NAMESPACE_URL, name);
  print("v5 is stable:", String(a === b));

  // Check untrusted input before you use it as an id.
  print(`valid: ${validate(id)}, invalid: ${validate("not-a-uuid")}`);

  // A ULID is 26 characters of Crockford base32. The first 10 encode the time.
  const sortable = ulid();
  print("ulid decodes to", new Date(decodeTime(sortable)).toISOString());
});
