// Copyright 2018-2026 the Deno authors. MIT license.
// This module is browser compatible.

/**
 * Converts a path string to a file URL.
 *
 * Exports {@linkcode toFileUrl}.
 *
 * @module
 */

import { encodeWhitespace } from "../_common/to_file_url.ts";
import { isAbsolute } from "./is_absolute.ts";

/**
 * Converts a path string to a file URL.
 *
 * @example Usage
 * ```ts
 * import { toFileUrl } from "@mikepage/flareosaur/path/posix/to-file-url";
 * import { assertEquals } from "@mikepage/flareosaur/assert";
 *
 * assertEquals(toFileUrl("/home/foo"), new URL("file:///home/foo"));
 * assertEquals(toFileUrl("/home/foo bar"), new URL("file:///home/foo%20bar"));
 * assertEquals(toFileUrl("//foo/bar"), new URL("file:///foo/bar"));
 * ```
 *
 * @param path The path to convert.
 * @returns The file URL.
 */
export function toFileUrl(path: string): URL {
  if (!isAbsolute(path)) {
    throw new TypeError(`Path must be absolute: received "${path}"`);
  }

  const url = new URL("file:///");
  url.pathname = encodeWhitespace(
    path.replace(/^\/+/, "/").replace(/%/g, "%25").replace(/\\/g, "%5C"),
  );
  return url;
}
