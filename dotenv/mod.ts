// Copyright 2018-2026 the Deno authors. MIT license.

/**
 * Parses and stringifies data in the `.env` file format.
 *
 * Note: The key needs to match the pattern /^[a-zA-Z_][a-zA-Z0-9_]*$/.
 *
 * ```ts
 * import { parse, stringify } from "@flareosaur/dotenv";
 * import { assertEquals } from "@flareosaur/assert";
 *
 * assertEquals(parse("GREETING=hello world"), { GREETING: "hello world" });
 * assertEquals(stringify({ GREETING: "hello world" }), "GREETING='hello world'");
 * ```
 *
 * Unlike `@std/dotenv`, there is no `load()`, `loadSync()` or `./load`
 * module: Workers have no filesystem and no process environment. Configure
 * variables and secrets as Worker bindings, or pass the text of a `.env` file
 * to {@linkcode parse}.
 *
 * @module
 */

export * from "./stringify.ts";
export * from "./parse.ts";
