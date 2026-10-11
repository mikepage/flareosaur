// Copyright 2026 the flareosaur authors. MIT license.
// Turns a script-style example into a Worker. The program prints with
// `Console.log`, like a Deno script printing to the terminal; the Worker
// runs it per request and responds with the printed lines as text/plain.

import { Cause, Console, Effect, Exit } from "effect"
import { inspect } from "../../internal/mod.ts"
import type { WorkerHandler } from "../../workers/Worker.ts"

const show = (value: unknown): string => typeof value === "string" ? value : inspect(value)

const recordingConsole = (lines: Array<string>): Console.Console => {
  const push = (...args: ReadonlyArray<unknown>) => {
    lines.push(args.map(show).join(" "))
  }
  return {
    ...globalThis.console,
    assert: (condition, ...args) => condition ? undefined : push("Assertion failed:", ...args),
    debug: push,
    error: push,
    info: push,
    log: push,
    trace: push,
    warn: push,
    table: (data) => push(data),
  } as Console.Console
}

/** Runs `program`, capturing everything it prints. */
export const capture = async <E>(program: Effect.Effect<unknown, E, never>): Promise<{ lines: Array<string>; ok: boolean }> => {
  const lines: Array<string> = []
  const exit = await Effect.runPromiseExit(program.pipe(Effect.provideService(Console.Console, recordingConsole(lines))))
  if (Exit.isFailure(exit)) lines.push(Cause.pretty(exit.cause))
  return { lines, ok: Exit.isSuccess(exit) }
}

/** A Worker that runs `program` on every request and returns what it printed. */
export const script = <E>(program: Effect.Effect<unknown, E, never>): WorkerHandler => ({
  async fetch() {
    const { lines, ok } = await capture(program)
    return new Response(lines.join("\n") + "\n", {
      status: ok ? 200 : 500,
      headers: { "content-type": "text/plain; charset=utf-8" },
    })
  },
})
