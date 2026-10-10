// Copyright 2018-2026 the Deno authors. MIT license.
// This module is browser compatible.

/**
 * Converts a string into CONSTANT_CASE (also known as SCREAMING_SNAKE_CASE).
 *
 * Exports {@linkcode toConstantCase}.
 *
 * @module
 */

import { splitToWords } from "./_util.ts";

/**
 * Converts a string into CONSTANT_CASE (also known as SCREAMING_SNAKE_CASE).
 *
 * @experimental **UNSTABLE**: New API, yet to be vetted.
 *
 * @example Usage
 * ```ts
 * import { toConstantCase } from "@mikepage/flareosaur/text/unstable-to-constant-case";
 * import { assertEquals } from "@mikepage/flareosaur/assert/equals";
 *
 * assertEquals(toConstantCase("deno is awesome"), "DENO_IS_AWESOME");
 * ```
 *
 * @param input The string that is going to be converted into CONSTANT_CASE
 * @returns The string as CONSTANT_CASE
 */
export function toConstantCase(input: string): string {
  input = input.trim();
  return splitToWords(input).join("_").toUpperCase();
}
