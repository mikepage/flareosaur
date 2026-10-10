// Copyright 2018-2026 the Deno authors. MIT license.
// This module is browser compatible.

/**
 * Determines the common path from a set of paths for Windows systems.
 *
 * Exports {@linkcode common}.
 *
 * @module
 */

import { common as _common } from "../_common/common.ts";
import { SEPARATOR } from "./constants.ts";

/**
 * Determines the common path from a set of paths for Windows systems.
 *
 * @example Usage
 * ```ts
 * import { common } from "@mikepage/flareosaur/path/windows/common";
 * import { assertEquals } from "@mikepage/flareosaur/assert";
 *
 * const path = common([
 *   "C:\\foo\\bar",
 *   "C:\\foo\\baz",
 * ]);
 * assertEquals(path, "C:\\foo\\");
 * ```
 *
 * @param paths The paths to compare.
 * @returns The common path.
 */
export function common(paths: string[]): string {
  return _common(paths, SEPARATOR);
}
