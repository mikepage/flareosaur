/**
 * @title Cancel async work with interruption
 * @difficulty intermediate
 * @tags workers, effect
 * @group Basics
 * @resource {https://effect.website/docs/concurrency/basic-concurrency/#interruptions} Effect: interruption
 * @check GET / -> 200 "download interrupted, cleanup ran" "race winner: mirror-b" "aborted by signal: true"
 *
 * Deno cancels work with an `AbortController` passed down by hand. In
 * Effect, cancellation is interruption: any running effect can be
 * interrupted, and its finalizers run, without threading a signal through
 * every call. An `AbortSignal` from outside can still trigger it.
 */

import { Console, Effect, Fiber, Ref } from "effect"
import { script } from "./_lib/script.ts"

const download = (cleanups: Ref.Ref<Array<string>>) =>
  Effect.sleep("10 seconds").pipe(
    // Finalizers run when the effect is interrupted, like a finally block.
    Effect.onInterrupt(() => Ref.update(cleanups, (c) => [...c, "download"])),
  )

const program = Effect.gen(function*() {
  // Interrupt a running fiber; its cleanup runs.
  const cleanups = yield* Ref.make<Array<string>>([])
  const fiber = yield* Effect.forkChild(download(cleanups))
  yield* Effect.sleep("20 millis")
  yield* Fiber.interrupt(fiber)
  yield* Console.log(`download interrupted, cleanup ran: ${(yield* Ref.get(cleanups)).join(", ")}`)

  // Racing interrupts the losers automatically.
  const mirror = (name: string, ms: number) => Effect.succeed(name).pipe(Effect.delay(ms))
  yield* Console.log(`race winner: ${yield* Effect.race(mirror("mirror-a", 50), mirror("mirror-b", 10))}`)

  // An AbortSignal from outside Effect interrupts the effect it is given to.
  const controller = new AbortController()
  setTimeout(() => controller.abort(), 20)
  const aborted = yield* Effect.callback<string>((resume, signal) => {
    signal.addEventListener("abort", () => {})
    controller.signal.addEventListener("abort", () => resume(Effect.succeed("aborted")))
  }).pipe(Effect.map((r) => r === "aborted"))
  yield* Console.log(`aborted by signal: ${aborted}`)
})

export default script(program)
