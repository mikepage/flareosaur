// Copyright 2018-2026 the Deno authors. MIT license.
// This module is browser compatible.

import { inspect as fallbackInspect } from "./inspect.ts";

/** An inspect function conforming to the shape of `Deno.inspect` and `node:util`'s `inspect` */
export type InspectFn = (
  v: unknown,
  options: {
    depth: number;
    sorted: boolean;
    trailingComma: boolean;
    compact: boolean;
    iterableLimit: number;
    getters: boolean;
    strAbbreviateSize: number;
  },
) => string;

/**
 * Converts the input into a string. Objects, Sets and Maps are sorted so as to
 * make tests less flaky.
 *
 * @param v Value to be formatted
 *
 * @returns The formatted string
 *
 * @example Usage
 * ```ts
 * import { format } from "@std/internal/format";
 * import { assertEquals } from "@std/assert";
 *
 * assertEquals(format({ a: 1, b: 2 }), "{\n  a: 1,\n  b: 2,\n}");
 * assertEquals(format(new Set([1, 2])), "Set(2) {\n  1,\n  2,\n}");
 * assertEquals(format(new Map([[1, 2]])), "Map(1) {\n  1 => 2,\n}");
 * ```
 */
export function format(v: unknown): string {
  // deno-lint-ignore no-explicit-any
  const { Deno, process } = globalThis as any;

  const inspect: InspectFn | undefined = Deno?.inspect ??
    process?.getBuiltinModule?.("node:util")?.inspect;

  const options = {
    depth: Infinity,
    sorted: true,
    trailingComma: true,
    compact: false,
    iterableLimit: Infinity,
    // getters should be true in assertEquals.
    getters: true,
    strAbbreviateSize: Infinity,
  };
  if (typeof inspect === "function") return inspect(v, options);
  try {
    return fallbackInspect(v, options);
  } catch {
    return "[[Unable to format value]]";
  }
}
