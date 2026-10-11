// Copyright 2018-2026 the Deno authors. MIT license.
// This module is browser compatible.

/**
 * Whether the current platform is Windows
 *
 * Exports {@linkcode isWindows}.
 *
 * @module
 */

import { checkWindows } from "./_os.ts";

/** Whether the current platform is Windows */
export const isWindows: boolean = checkWindows();
