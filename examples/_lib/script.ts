// Copyright 2026 the flareosaur authors. MIT license.
// Turns a script-style example into a Worker. A Deno example prints to the
// terminal; here the script gets a `print` function, and the Worker
// responds with the printed lines as text/plain. Nothing is shared between
// requests: every request gets its own lines.

import { inspect } from "@mikepage/flareosaur/internal/inspect";

/** Prints values on one line, strings as-is and anything else inspected. */
export type Print = (...values: unknown[]) => void;

/** A Worker that runs `main` on every request and returns what it printed. */
export function script<Env = unknown>(
  main: (print: Print, env: Env) => unknown,
): ExportedHandler<Env> {
  return {
    async fetch(_request, env) {
      const lines: string[] = [];
      const print: Print = (...values) =>
        lines.push(values.map((v) => typeof v === "string" ? v : inspect(v)).join(" "));
      let status = 200;
      try {
        await main(print, env);
      } catch (error) {
        status = 500;
        lines.push(error instanceof Error ? error.stack ?? error.message : String(error));
      }
      return new Response(lines.join("\n") + "\n", {
        status,
        headers: { "content-type": "text/plain; charset=utf-8" },
      });
    },
  };
}
