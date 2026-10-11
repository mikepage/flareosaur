// Copyright 2018-2026 the Deno authors. MIT license.
// Copyright 2026 the flareosaur authors. MIT license.

/**
 * A circuit breaker for effects, ported from `@std/async`'s unstable
 * `CircuitBreaker` onto `Ref` and `Clock`.
 *
 * The breaker counts requests and failures in a sliding time window. While
 * `"closed"` it lets effects through; once the failure rate reaches
 * `failureRateThreshold` (after at least `minimumThroughput` requests) it
 * opens and fails every effect at once with a
 * {@linkcode CircuitBreakerOpenError}. After `cooldown` it is `"half_open"`:
 * up to `halfOpenMaxConcurrent` trial effects run, and `successThreshold`
 * successes in a row close it again, while one failure reopens it.
 *
 * Time comes from `Clock`, so `TestClock` drives the window and the
 * cooldown. Typed failures count when `isFailure` says so (default: all);
 * defects always count; interruptions never do.
 *
 * ```ts
 * import { Effect } from "effect"
 * import { CircuitBreaker } from "@mikepage/flareosaur/async/circuit-breaker"
 *
 * declare const callService: Effect.Effect<string, Error>
 *
 * const program = Effect.gen(function*() {
 *   const breaker = yield* CircuitBreaker.make({ failureRateThreshold: 0.5, cooldown: "30 seconds" })
 *   return yield* breaker.execute(callService) // Effect<string, Error | CircuitBreakerOpenError>
 * })
 * ```
 *
 * @module
 */

import { Cause, Clock, Duration, Effect, Exit, Option, Ref, Schema } from "effect"
import { RollingCounter } from "../data_structures/mod.ts"

/** The state of a {@linkcode CircuitBreaker}. */
export type CircuitState = "closed" | "open" | "half_open"

/** The breaker is open (or its half-open trial slots are taken); the effect did not run. */
export class CircuitBreakerOpenError extends Schema.TaggedError<CircuitBreakerOpenError>()("CircuitBreakerOpenError", {
  message: Schema.String,
  /** Milliseconds until the breaker becomes half-open; 0 when half-open but full. */
  remainingCooldownMillis: Schema.Number,
}) {}

/** Options for {@linkcode CircuitBreaker.make}. All callbacks run synchronously. */
export interface CircuitBreakerOptions<A = unknown, E = unknown> {
  /** The failure rate, in (0, 1], that opens the breaker. Defaults to 0.5. */
  readonly failureRateThreshold?: number | undefined
  /** The fewest requests in the window before the rate is considered. Defaults to 20. */
  readonly minimumThroughput?: number | undefined
  /** The sliding window requests are counted in. Defaults to 60 seconds. */
  readonly window?: Duration.Input | undefined
  /** How many segments the window moves by. Defaults to 10. */
  readonly segmentsPerWindow?: number | undefined
  /** How long the breaker stays open. Defaults to 30 seconds. */
  readonly cooldown?: Duration.Input | undefined
  /** Successes in a row, while half-open, that close the breaker. Defaults to 2. */
  readonly successThreshold?: number | undefined
  /** Trial effects allowed at once while half-open. Defaults to 3. */
  readonly halfOpenMaxConcurrent?: number | undefined
  /** Which typed errors count as failures. Defaults to all. */
  readonly isFailure?: ((error: E) => boolean) | undefined
  /** Which successful results count as failures. Defaults to none. */
  readonly isResultFailure?: ((result: A) => boolean) | undefined
  /** Called on every state change. */
  readonly onStateChange?: ((from: CircuitState, to: CircuitState) => void) | undefined
  /** Called on every counted failure, with the window's counts. */
  readonly onFailure?: ((cause: Cause.Cause<unknown> | undefined, failures: number, requests: number) => void) | undefined
  /** Called when the breaker opens. */
  readonly onOpen?: ((failures: number, requests: number) => void) | undefined
  /** Called when the breaker becomes half-open. */
  readonly onHalfOpen?: (() => void) | undefined
  /** Called when the breaker closes. */
  readonly onClose?: (() => void) | undefined
}

interface State {
  readonly state: CircuitState
  readonly openedAt: number
  readonly consecutiveSuccesses: number
  readonly halfOpenInFlight: number
  readonly generation: number
}

const closed = (generation: number): State => ({
  state: "closed",
  openedAt: 0,
  consecutiveSuccesses: 0,
  halfOpenInFlight: 0,
  generation,
})

const positiveInteger = (name: string, value: number) => {
  if (!Number.isInteger(value) || value < 1) {
    throw new RangeError(`Cannot create circuit breaker: "${name}" must be a positive integer, received ${value}`)
  }
}

type Event = () => void

/** A circuit breaker; see the module documentation. */
export class CircuitBreaker<A = unknown, E = unknown> {
  readonly #threshold: number
  readonly #minimumThroughput: number
  readonly #cooldown: number
  readonly #successThreshold: number
  readonly #halfOpenMax: number
  readonly #msPerSegment: number
  readonly #options: CircuitBreakerOptions<A, E>
  readonly #state: Ref.Ref<State>
  readonly #requests: RollingCounter
  readonly #failures: RollingCounter
  #lastRotation: number

  private constructor(options: CircuitBreakerOptions<A, E>, state: Ref.Ref<State>, now: number) {
    const threshold = options.failureRateThreshold ?? 0.5
    if (!Number.isFinite(threshold) || threshold <= 0 || threshold > 1) {
      throw new RangeError(`Cannot create circuit breaker: "failureRateThreshold" must be in (0, 1], received ${threshold}`)
    }
    const minimumThroughput = options.minimumThroughput ?? 20
    const segments = options.segmentsPerWindow ?? 10
    const successThreshold = options.successThreshold ?? 2
    const halfOpenMax = options.halfOpenMaxConcurrent ?? 3
    positiveInteger("minimumThroughput", minimumThroughput)
    positiveInteger("segmentsPerWindow", segments)
    positiveInteger("successThreshold", successThreshold)
    positiveInteger("halfOpenMaxConcurrent", halfOpenMax)
    const window = Duration.toMillis(options.window ?? "60 seconds")
    const cooldown = Duration.toMillis(options.cooldown ?? "30 seconds")
    if (!(window > 0) || !Number.isFinite(window)) {
      throw new RangeError(`Cannot create circuit breaker: "window" must be a positive finite duration`)
    }
    if (!(cooldown >= 0) || !Number.isFinite(cooldown)) {
      throw new RangeError(`Cannot create circuit breaker: "cooldown" must be a non-negative finite duration`)
    }
    this.#threshold = threshold
    this.#minimumThroughput = minimumThroughput
    this.#cooldown = cooldown
    this.#successThreshold = successThreshold
    this.#halfOpenMax = halfOpenMax
    this.#msPerSegment = window / segments
    this.#options = options
    this.#state = state
    this.#requests = new RollingCounter(segments)
    this.#failures = new RollingCounter(segments)
    this.#lastRotation = now
  }

  /** Creates a closed breaker. Invalid options die with a `RangeError`. */
  static make<A = unknown, E = unknown>(options: CircuitBreakerOptions<A, E> = {}): Effect.Effect<CircuitBreaker<A, E>> {
    return Effect.gen(function*() {
      const now = yield* Clock.currentTimeMillis
      const state = yield* Ref.make(closed(0))
      return new CircuitBreaker(options, state, now)
    })
  }

  #rotate(now: number): void {
    const steps = Math.floor((now - this.#lastRotation) / this.#msPerSegment)
    if (steps > 0) {
      this.#requests.rotate(steps)
      this.#failures.rotate(steps)
      this.#lastRotation += steps * this.#msPerSegment
    }
  }

  #clearCounters(now: number): void {
    this.#requests.clear()
    this.#failures.clear()
    this.#lastRotation = now
  }

  // Moves an open breaker whose cooldown is over to half-open.
  #advance(state: State, now: number, events: Array<Event>): State {
    if (state.state !== "open" || now < state.openedAt + this.#cooldown) return state
    events.push(() => {
      this.#options.onStateChange?.("open", "half_open")
      this.#options.onHalfOpen?.()
    })
    return { ...state, state: "half_open", consecutiveSuccesses: 0, halfOpenInFlight: 0, generation: state.generation + 1 }
  }

  #modify<B>(f: (state: State, now: number, events: Array<Event>) => readonly [B, State]): Effect.Effect<B> {
    return Effect.flatMap(Clock.currentTimeMillis, (now) => {
      const events: Array<Event> = []
      return Effect.map(
        Ref.modify(this.#state, (state) => f(this.#advance(state, now, events), now, events)),
        (b) => {
          for (const event of events) event()
          return b
        },
      )
    })
  }

  /** The current state (an open breaker past its cooldown reports `"half_open"`). */
  get state(): Effect.Effect<CircuitState> {
    return this.#modify((state) => [state.state, state])
  }

  #onFailure(state: State, previous: CircuitState, cause: Cause.Cause<unknown> | undefined, now: number, events: Array<Event>): State {
    this.#rotate(now)
    this.#failures.increment()
    const requests = this.#requests.total
    const failures = this.#failures.total
    const shouldOpen = previous === "half_open" ||
      (requests >= this.#minimumThroughput && failures / requests >= this.#threshold)
    const alreadyOpen = state.state === "open"
    events.push(() => this.#options.onFailure?.(cause, failures, requests))
    if (!shouldOpen) return { ...state, consecutiveSuccesses: 0 }
    if (!alreadyOpen) {
      events.push(() => {
        this.#options.onStateChange?.(state.state, "open")
        this.#options.onOpen?.(failures, requests)
      })
    }
    return { ...state, state: "open", openedAt: alreadyOpen ? state.openedAt : now, consecutiveSuccesses: 0 }
  }

  #onSuccess(state: State, previous: CircuitState, generation: number, now: number, events: Array<Event>): State {
    if (previous === "closed" || state.state !== "half_open" || state.generation !== generation) return state
    const successes = state.consecutiveSuccesses + 1
    if (successes < this.#successThreshold) return { ...state, consecutiveSuccesses: successes }
    this.#clearCounters(now)
    events.push(() => {
      this.#options.onStateChange?.("half_open", "closed")
      this.#options.onClose?.()
    })
    return closed(state.generation)
  }

  /**
   * Runs `effect` through the breaker: fails at once with a
   * {@linkcode CircuitBreakerOpenError} when open, otherwise runs it and
   * records the outcome.
   */
  execute<A2 extends A, E2 extends E, R>(effect: Effect.Effect<A2, E2, R>): Effect.Effect<A2, E2 | CircuitBreakerOpenError, R> {
    type Admission = { readonly previous: CircuitState; readonly generation: number } | CircuitBreakerOpenError
    const admit = this.#modify<Admission>((state, now) => {
      if (state.state === "open") {
        const remaining = Math.max(0, Math.round(state.openedAt + this.#cooldown - now))
        return [new CircuitBreakerOpenError({ message: `Circuit breaker is open: retry after ${remaining}ms`, remainingCooldownMillis: remaining }), state]
      }
      if (state.state === "half_open") {
        if (state.halfOpenInFlight >= this.#halfOpenMax) {
          return [new CircuitBreakerOpenError({ message: "Circuit breaker is half-open and at capacity", remainingCooldownMillis: 0 }), state]
        }
        return [{ previous: state.state, generation: state.generation }, { ...state, halfOpenInFlight: state.halfOpenInFlight + 1 }]
      }
      return [{ previous: state.state, generation: state.generation }, state]
    })

    const record = (admission: { readonly previous: CircuitState; readonly generation: number }, exit: Exit.Exit<A2, E2>) =>
      this.#modify((current, now, events) => {
        let state = current
        if (admission.previous === "half_open" && state.generation === admission.generation) {
          state = { ...state, halfOpenInFlight: Math.max(0, state.halfOpenInFlight - 1) }
        }
        if (Exit.isFailure(exit) && Cause.hasInterruptsOnly(exit.cause)) return [undefined, state]
        this.#rotate(now)
        this.#requests.increment()
        if (Exit.isFailure(exit)) {
          const error = Exit.findErrorOption(exit)
          const counts = Option.isNone(error) || (this.#options.isFailure?.(error.value) ?? true)
          return [undefined, counts ? this.#onFailure(state, admission.previous, exit.cause, now, events) : state]
        }
        return [
          undefined,
          this.#options.isResultFailure?.(exit.value)
            ? this.#onFailure(state, admission.previous, undefined, now, events)
            : this.#onSuccess(state, admission.previous, admission.generation, now, events),
        ]
      })

    return Effect.flatMap(admit, (admission): Effect.Effect<A2, E2 | CircuitBreakerOpenError, R> =>
      admission instanceof CircuitBreakerOpenError
        ? Effect.fail(admission)
        : Effect.onExit(effect, (exit) => record(admission, exit)))
  }

  /** Opens the breaker now, starting a new cooldown. */
  get forceOpen(): Effect.Effect<void> {
    return this.#modify((state, now, events) => {
      this.#rotate(now)
      if (state.state !== "open") {
        events.push(() => {
          this.#options.onStateChange?.(state.state, "open")
          this.#options.onOpen?.(this.#failures.total, this.#requests.total)
        })
      }
      return [undefined, { ...state, state: "open", openedAt: now, consecutiveSuccesses: 0 }]
    })
  }

  /** Closes the breaker now and clears its counts. */
  get forceClose(): Effect.Effect<void> {
    return this.#modify((state, now, events) => {
      this.#clearCounters(now)
      if (state.state !== "closed") {
        events.push(() => {
          this.#options.onStateChange?.(state.state, "closed")
          this.#options.onClose?.()
        })
      }
      return [undefined, closed(state.generation + 1)]
    })
  }

  /** Closes the breaker and clears its counts without calling any callback. */
  get reset(): Effect.Effect<void> {
    return this.#modify((state, now) => {
      this.#clearCounters(now)
      return [undefined, closed(state.generation + 1)]
    })
  }
}
