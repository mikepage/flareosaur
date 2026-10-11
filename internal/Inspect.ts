// Copyright 2026 the flareosaur authors. MIT license.

/**
 * Deno-style value formatting on any runtime: `inspect` reproduces the
 * layout of `Deno.inspect` (depth, compact, sorted keys, trailing commas,
 * circular references), and `format` is the layout `assertEquals` diffs.
 * Values that implement Effect's `Redactable`, such as `Redacted`, are
 * redacted first, so secrets never end up in a test failure or a log line.
 *
 * ```ts
 * import { Redacted } from "effect"
 * import { format } from "@mikepage/flareosaur/internal/inspect"
 *
 * format({ token: Redacted.make("hunter2") }) // "{\n  token: <redacted>,\n}"
 * ```
 *
 * @module
 */

import { Redactable } from "effect"
import { inspect as stdInspect, type InspectOptions } from "./_std/inspect.ts"
import { format as stdFormat } from "./_std/format.ts"

export type { InspectOptions }

/** Formats a value like `Deno.inspect`, without colors. */
export const inspect = (value: unknown, options?: InspectOptions): string => stdInspect(Redactable.redact(value), options)

/** Formats a value for assertion diffs: multi-line, sorted, with trailing commas. */
export const format = (value: unknown): string => stdFormat(Redactable.redact(value))
