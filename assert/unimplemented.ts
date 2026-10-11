// Copyright 2018-2026 the Deno authors. MIT license.
// This module is browser compatible.

/**
 * Use this to stub out methods that will throw when invoked.
 *
 * Exports {@linkcode unimplemented}.
 *
 * @module
 */
import { AssertionError } from "./assertion_error.ts";

/**
 * Use this to stub out methods that will throw when invoked.
 *
 * @example Usage
 * ```ts ignore
 * import { unimplemented } from "@mikepage/flareosaur/assert";
 *
 * unimplemented(); // Throws
 * ```
 *
 * @param msg Optional message to include in the error.
 * @returns Never returns, always throws.
 */
export function unimplemented(msg?: string): never {
  const msgSuffix = msg ? `: ${msg}` : ".";
  throw new AssertionError(`Unimplemented${msgSuffix}`);
}
