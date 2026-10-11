// Copyright 2018-2026 the Deno authors. MIT license.
// Copyright 2026 the flareosaur authors. MIT license.

/**
 * `@std/async`'s helpers, rebuilt on Effect's fibers, `Schedule`, `Clock`
 * and `Stream`.
 *
 * Most of std/async is built into Effect. This module keeps std's names and
 * option shapes, implements them with Effect, and every helper's docs name
 * the Effect equivalent:
 *
 * | std                    | here                                   | Effect                                    |
 * | ---------------------- | -------------------------------------- | ----------------------------------------- |
 * | `delay`                | {@linkcode delay}                      | `Effect.sleep`                            |
 * | `retry`                | {@linkcode retry}, {@linkcode retrySchedule} | `Effect.retry` + `Schedule.exponential` |
 * | `deadline`             | {@linkcode deadline}                   | `Effect.timeoutOrElse`                    |
 * | `abortable`            | {@linkcode abortable}                  | `Effect.raceFirst`, `Stream.interruptWhen` |
 * | `debounce`             | {@linkcode debounce}                   | `FiberHandle` + `Effect.sleep`            |
 * | `throttle`             | {@linkcode throttle}                   | `FiberSet` + `Clock`                      |
 * | `pooledMap`            | {@linkcode pooledMap}                  | `Stream.mapEffect` with `concurrency`     |
 * | `pooledMapSettled`     | {@linkcode pooledMapSettled}           | `Stream.mapEffect` + `Effect.result`      |
 * | `MuxAsyncIterator`     | {@linkcode mux}                        | `Stream.mergeAll`                         |
 * | `tee`                  | {@linkcode tee}                        | `Stream.broadcastN`                       |
 * | `poll`                 | {@linkcode poll}                       | `Effect.repeat` with `until`              |
 * | `waitFor`              | {@linkcode waitFor}                    | `Effect.repeat` + `Effect.timeoutOrElse`  |
 * | `Lazy`                 | {@linkcode lazy}                       | `Cache` (failures are not cached)         |
 * | `allKeyed`             | {@linkcode allKeyed}                   | `Effect.all` on a record                  |
 * | `allSettledKeyed`      | {@linkcode allSettledKeyed}            | `Effect.all` with `mode: "result"`        |
 * | `Semaphore`            | {@linkcode semaphore}                  | `Semaphore.make`, `Semaphore.withPermits` |
 * | `Channel`              | (none)                                 | `Queue.bounded`                           |
 * | `CircuitBreaker`       | `CircuitBreaker` (`./circuit-breaker`) | built on `Ref` and `Clock`                |
 *
 * Time always comes from Effect's `Clock`, so tests drive every timer with
 * `TestClock`.
 *
 * ```ts
 * import { Effect } from "effect"
 * import { deadline, retry } from "@mikepage/flareosaur/async"
 *
 * declare const fetchUser: Effect.Effect<{ name: string }, Error>
 *
 * const program = fetchUser.pipe(
 *   retry({ maxAttempts: 3, minTimeout: "100 millis" }), // fails with RetryError after 3 attempts
 *   deadline("5 seconds"), // fails with DeadlineError after 5 seconds
 * )
 * ```
 *
 * @module
 */

import {
  Cache,
  type Cause,
  Clock,
  Duration,
  Effect,
  Exit,
  FiberHandle,
  FiberSet,
  Function,
  Option,
  Random,
  type Result,
  Schedule,
  Schema,
  type Scope,
  Semaphore,
  Stream,
  type Types,
} from "effect"

export * from "./CircuitBreaker.ts"

// ---------------------------------------------------------------------------
// Errors
// ---------------------------------------------------------------------------

const RetryErrorBase: Schema.Class<
  RetryError,
  Schema.TaggedStruct<"RetryError", {
    readonly message: Schema.String
    readonly attempts: Schema.Number
    readonly cause: Schema.Defect
  }>,
  Cause.YieldableError
> = Schema.TaggedError<RetryError>()("RetryError", {
  message: Schema.String,
  attempts: Schema.Number,
  cause: Schema.Defect(),
})

/** {@linkcode retry} ran out of attempts. `cause` is the last error. */
export class RetryError extends RetryErrorBase {}

const DeadlineErrorBase: Schema.Class<
  DeadlineError,
  Schema.TaggedStruct<"DeadlineError", {
    readonly message: Schema.String
  }>,
  Cause.YieldableError
> = Schema.TaggedError<DeadlineError>()("DeadlineError", {
  message: Schema.String,
})

/** An effect did not finish before its {@linkcode deadline}. */
export class DeadlineError extends DeadlineErrorBase {}

const AbortedErrorBase: Schema.Class<
  AbortedError,
  Schema.TaggedStruct<"AbortedError", {
    readonly message: Schema.String
    readonly reason: Schema.Defect
  }>,
  Cause.YieldableError
> = Schema.TaggedError<AbortedError>()("AbortedError", {
  message: Schema.String,
  reason: Schema.Defect(),
})

/** An effect or stream was stopped by an `AbortSignal` (see {@linkcode abortable}). */
export class AbortedError extends AbortedErrorBase {}

const AsyncIterableErrorBase: Schema.Class<
  AsyncIterableError,
  Schema.TaggedStruct<"AsyncIterableError", {
    readonly message: Schema.String
    readonly cause: Schema.Defect
  }>,
  Cause.YieldableError
> = Schema.TaggedError<AsyncIterableError>()("AsyncIterableError", {
  message: Schema.String,
  cause: Schema.Defect(),
})

/** An `AsyncIterable` given to {@linkcode mux}, {@linkcode tee} or {@linkcode pooledMap} threw. */
export class AsyncIterableError extends AsyncIterableErrorBase {}

// ---------------------------------------------------------------------------
// delay, deadline, abortable
// ---------------------------------------------------------------------------

/** Waits for `duration`. Exactly `Effect.sleep`. */
export const delay = (duration: Duration.Input): Effect.Effect<void> => Effect.sleep(duration)

/**
 * Fails with a {@linkcode DeadlineError} when `self` does not finish within
 * `duration`, interrupting it. `Effect.timeoutOrElse` with a typed error
 * (`Effect.timeout` fails with `Cause.TimeoutError` instead).
 */
export const deadline: {
  (duration: Duration.Input): <A, E, R>(self: Effect.Effect<A, E, R>) => Effect.Effect<A, E | DeadlineError, R>
  <A, E, R>(self: Effect.Effect<A, E, R>, duration: Duration.Input): Effect.Effect<A, E | DeadlineError, R>
} = Function.dual(
  2,
  <A, E, R>(self: Effect.Effect<A, E, R>, duration: Duration.Input): Effect.Effect<A, E | DeadlineError, R> =>
    Effect.timeoutOrElse(self, {
      duration,
      orElse: () =>
        Effect.fail(new DeadlineError({ message: `Deadline of ${Duration.format(Duration.fromInputUnsafe(duration))} exceeded` })),
    }),
)

const onAbort = (signal: AbortSignal): Effect.Effect<never, AbortedError> =>
  Effect.callback<never, AbortedError>((resume) => {
    const abort = () => resume(Effect.fail(new AbortedError({ message: "The operation was aborted", reason: signal.reason })))
    if (signal.aborted) return abort()
    signal.addEventListener("abort", abort, { once: true })
    return Effect.sync(() => signal.removeEventListener("abort", abort))
  })

/**
 * Stops an effect or a stream when `signal` aborts, failing it with an
 * {@linkcode AbortedError} that carries the signal's reason. An already
 * aborted signal fails at once.
 *
 * For effects this is `Effect.raceFirst` against the signal; for streams,
 * `Stream.interruptWhen`. Inside Effect, prefer interruption itself: every
 * effect can be interrupted, and `Effect.runPromise(effect, { signal })`
 * interrupts on abort.
 */
export function abortable<A, E, R>(self: Effect.Effect<A, E, R>, signal: AbortSignal): Effect.Effect<A, E | AbortedError, R>
export function abortable<A, E, R>(self: Stream.Stream<A, E, R>, signal: AbortSignal): Stream.Stream<A, E | AbortedError, R>
export function abortable<A, E, R>(
  self: Effect.Effect<A, E, R> | Stream.Stream<A, E, R>,
  signal: AbortSignal,
): Effect.Effect<A, E | AbortedError, R> | Stream.Stream<A, E | AbortedError, R> {
  if (Stream.isStream(self)) {
    const stream = self as Stream.Stream<A, E, R>
    return Stream.suspend(() => signal.aborted ? Stream.fromEffect(onAbort(signal)) : Stream.interruptWhen(stream, onAbort(signal)))
  }
  const effect = self as Effect.Effect<A, E, R>
  return Effect.suspend(() => signal.aborted ? onAbort(signal) : Effect.raceFirst(effect, onAbort(signal)))
}

// ---------------------------------------------------------------------------
// retry
// ---------------------------------------------------------------------------

/** std's retry options, with `Duration`s for the timeouts. */
export interface RetryOptions<E = unknown> {
  /** How much the delay grows per attempt. Defaults to 2; at least 1. */
  readonly multiplier?: number | undefined
  /** The longest delay. Defaults to 60 seconds. */
  readonly maxTimeout?: Duration.Input | undefined
  /** How many times to run the effect, the first run included. Defaults to 5. */
  readonly maxAttempts?: number | undefined
  /** The first delay. Defaults to 1 second. */
  readonly minTimeout?: Duration.Input | undefined
  /**
   * How much randomness to take off each delay, from 0 (none) to 1 (the
   * default: anywhere between 0 and the full delay). Uses Effect's `Random`.
   */
  readonly jitter?: number | undefined
  /** Which errors to retry. Defaults to all; others fail at once, unchanged. */
  readonly isRetriable?: ((error: E) => boolean) | undefined
}

/**
 * The `Schedule` behind {@linkcode retry}: exponential backoff from
 * `minTimeout`, growing by `multiplier`, capped at `maxTimeout`, with
 * `jitter`, for `maxAttempts - 1` retries. Use it with `Effect.retry`
 * directly when the {@linkcode RetryError} wrapping is not wanted.
 *
 * Throws a `RangeError` for invalid options, like std.
 */
export const retrySchedule = (options?: RetryOptions<never>): Schedule.Schedule<Duration.Duration> => {
  const multiplier = options?.multiplier ?? 2
  const maxAttempts = options?.maxAttempts ?? 5
  const jitter = options?.jitter ?? 1
  const maxTimeout = Duration.toMillis(options?.maxTimeout ?? "60 seconds")
  const minTimeout = Duration.toMillis(options?.minTimeout ?? "1 second")
  if (!Number.isInteger(maxAttempts) || maxAttempts < 1) {
    throw new RangeError(`Cannot retry as 'maxAttempts' must be a positive integer: current value is ${maxAttempts}`)
  }
  if (!Number.isFinite(multiplier) || multiplier < 1) {
    throw new RangeError(`Cannot retry as 'multiplier' must be a finite number >= 1: current value is ${multiplier}`)
  }
  if (Number.isNaN(maxTimeout) || maxTimeout <= 0) {
    throw new RangeError(`Cannot retry as 'maxTimeout' must be positive: current value is ${maxTimeout}ms`)
  }
  if (Number.isNaN(minTimeout) || minTimeout < 0) {
    throw new RangeError(`Cannot retry as 'minTimeout' must be >= 0: current value is ${minTimeout}ms`)
  }
  if (minTimeout > maxTimeout) {
    throw new RangeError(`Cannot retry as 'minTimeout' must be <= 'maxTimeout'`)
  }
  if (Number.isNaN(jitter) || jitter < 0 || jitter > 1) {
    throw new RangeError(`Cannot retry as 'jitter' must be between 0 and 1: current value is ${jitter}`)
  }
  const backoff = Schedule.exponential(Duration.millis(minTimeout), multiplier).pipe(
    Schedule.modifyDelay(({ duration }) => {
      const capped = Math.min(maxTimeout, Duration.toMillis(duration))
      return jitter === 0
        ? Effect.succeed(Duration.millis(capped))
        : Effect.map(Random.next, (r) => Duration.millis((1 - jitter * r) * capped))
    }),
  )
  return Schedule.max([backoff, Schedule.recurs(maxAttempts - 1)])
}

/**
 * Runs `self` until it succeeds, waiting with exponential backoff between
 * attempts ({@linkcode retrySchedule}). Errors `isRetriable` rejects fail
 * at once; after `maxAttempts` the last error is wrapped in a
 * {@linkcode RetryError}.
 *
 * `Effect.retry(self, { schedule: retrySchedule(options), while: isRetriable })`,
 * plus the wrapping.
 */
export const retry: {
  <E>(options?: RetryOptions<NoInfer<E>>): <A, R>(self: Effect.Effect<A, E, R>) => Effect.Effect<A, E | RetryError, R>
  <A, E, R>(self: Effect.Effect<A, E, R>, options?: RetryOptions<NoInfer<E>>): Effect.Effect<A, E | RetryError, R>
} = Function.dual(
  (args: IArguments) => Effect.isEffect(args[0]),
  <A, E, R>(self: Effect.Effect<A, E, R>, options?: RetryOptions<E>): Effect.Effect<A, E | RetryError, R> =>
    Effect.suspend(() => {
      const schedule = retrySchedule(options as RetryOptions<never>)
      const isRetriable = options?.isRetriable ?? (() => true)
      const attempts = options?.maxAttempts ?? 5
      const retried: Effect.Effect<A, E, R> = Effect.retry(self, { schedule, while: isRetriable })
      return Effect.catch(retried, (error): Effect.Effect<never, E | RetryError> =>
        isRetriable(error)
          ? Effect.fail(new RetryError({ message: `Retrying exceeded the maxAttempts (${attempts}).`, attempts, cause: error }))
          : Effect.fail(error))
    }),
)

// ---------------------------------------------------------------------------
// debounce, throttle
// ---------------------------------------------------------------------------

/** A debounced function from {@linkcode debounce}. Calls are fire-and-forget. */
export interface DebouncedFunction<Args extends ReadonlyArray<unknown>> {
  /** Schedules the function to run with these arguments after the wait, cancelling any earlier pending call. */
  (...args: Args): void
  /** Cancels the pending call. */
  clear(): void
  /** Runs the pending call now. */
  flush(): void
  /** Whether a call is waiting to run. */
  readonly pending: boolean
}

/**
 * Debounces an effectful function: each call restarts a timer of `wait`, and
 * only the last call's effect runs, once the timer ends.
 *
 * The returned function is a plain function, for event handlers and other
 * callbacks, but runs the effect in a fiber of the current scope (built on
 * `FiberHandle` and `Effect.sleep`): the timer uses `Clock`, works with
 * `TestClock`, and stops when the scope closes. The effect gets the services
 * of the scope that created the function.
 */
export const debounce = <Args extends ReadonlyArray<any>, R>(
  fn: (...args: Args) => Effect.Effect<unknown, never, R>,
  wait: Duration.Input,
): Effect.Effect<DebouncedFunction<Args>, never, Scope.Scope | R> =>
  Effect.map(FiberHandle.makeRuntime<R>(), (run) => {
    let pending: Option.Option<Args> = Option.none()
    const fire = (args: Args) =>
      Effect.suspend(() => {
        pending = Option.none()
        return fn(...args)
      })
    const debounced = ((...args: Args) => {
      pending = Option.some(args)
      run(Effect.andThen(Effect.sleep(wait), fire(args)))
    }) as DebouncedFunction<Args>
    debounced.clear = () => {
      if (Option.isNone(pending)) return
      pending = Option.none()
      run(Effect.void)
    }
    debounced.flush = () => {
      if (Option.isSome(pending)) run(fire(pending.value))
    }
    Object.defineProperty(debounced, "pending", { get: () => Option.isSome(pending) })
    return debounced
  })

/** Options for {@linkcode throttle}. */
export interface ThrottleOptions {
  /**
   * Run the last call made while throttled, once the timeframe after it
   * ends. Defaults to `false`: calls made while throttled are dropped.
   */
  readonly ensureLastCall?: boolean | undefined
}

/** A throttled function from {@linkcode throttle}. Calls are fire-and-forget. */
export interface ThrottledFunction<Args extends ReadonlyArray<unknown>> {
  /** Runs the function now, unless throttled. */
  (...args: Args): void
  /** Ends the throttling and cancels a pending last call. */
  clear(): void
  /** Runs the pending last call now. */
  flush(): void
  /** Whether calls are being throttled: the function is running, or ran within the timeframe. */
  readonly throttling: boolean
  /** When the last run ended, in `Clock` milliseconds. */
  readonly lastExecution: Option.Option<number>
}

/**
 * Throttles an effectful function: it runs at most once per `timeframe`,
 * measured from the end of the previous run, and never while a previous run
 * is still going. `timeframe` can be a function of how long the previous run
 * took, for adaptive throttling.
 *
 * Like {@linkcode debounce}, the result is a plain function whose runs are
 * fibers of the current scope (`FiberSet`), timed by `Clock`.
 */
export const throttle = <Args extends ReadonlyArray<any>, R>(
  fn: (...args: Args) => Effect.Effect<unknown, never, R>,
  timeframe: Duration.Input | ((previousDuration: Duration.Duration) => Duration.Input),
  options?: ThrottleOptions,
): Effect.Effect<ThrottledFunction<Args>, never, Scope.Scope | R> =>
  Effect.gen(function*() {
    const clock = yield* Clock.Clock
    const runExecution = yield* FiberSet.makeRuntime<R>()
    const runTimer = yield* FiberHandle.makeRuntime<never>()
    const ensureLast = options?.ensureLastCall ?? false
    let frame = typeof timeframe === "function" ? 0 : Duration.toMillis(timeframe)
    let lastExecution = Number.NEGATIVE_INFINITY
    let running = false
    let pending: Option.Option<Args> = Option.none()

    const isThrottling = () => running || clock.currentTimeMillisUnsafe() - lastExecution <= frame

    const execute = (args: Args) => {
      pending = Option.none()
      runTimer(Effect.void)
      running = true
      const start = clock.currentTimeMillisUnsafe()
      runExecution(Effect.ensuring(
        Effect.suspend(() => fn(...args)),
        Effect.sync(() => {
          running = false
          lastExecution = clock.currentTimeMillisUnsafe()
          if (typeof timeframe === "function") {
            frame = Duration.toMillis(timeframe(Duration.millis(lastExecution - start)))
          }
        }),
      ))
    }

    const throttled = ((...args: Args) => {
      if (!isThrottling()) return execute(args)
      if (!ensureLast) return
      pending = Option.some(args)
      runTimer(Effect.andThen(
        Effect.sleep(Duration.millis(frame)),
        Effect.sync(() => {
          if (Option.isSome(pending)) execute(pending.value)
        }),
      ))
    }) as ThrottledFunction<Args>
    throttled.clear = () => {
      lastExecution = Number.NEGATIVE_INFINITY
      running = false
      pending = Option.none()
      runTimer(Effect.void)
    }
    throttled.flush = () => {
      if (Option.isSome(pending)) execute(pending.value)
    }
    Object.defineProperties(throttled, {
      throttling: { get: isThrottling },
      lastExecution: {
        get: () => Number.isFinite(lastExecution) ? Option.some(lastExecution) : Option.none(),
      },
    })
    return throttled
  })

// ---------------------------------------------------------------------------
// Streams: pooledMap, mux, tee
// ---------------------------------------------------------------------------

/** What the stream helpers accept: a `Stream`, an `AsyncIterable` or an `Iterable`. */
export type Source<A, E = never, R = never> = Stream.Stream<A, E, R> | AsyncIterable<A> | Iterable<A>

const iterableError = (cause: unknown) =>
  new AsyncIterableError({ message: cause instanceof Error ? cause.message : String(cause), cause })

/** A source as a `Stream`; errors thrown by an `AsyncIterable` become {@linkcode AsyncIterableError}s. */
export const toStream = <A, E = never, R = never>(source: Source<A, E, R>): Stream.Stream<A, E | AsyncIterableError, R> =>
  Stream.isStream(source)
    ? source as Stream.Stream<A, E, R>
    : Symbol.asyncIterator in source
    ? Stream.fromAsyncIterable(source as AsyncIterable<A>, iterableError)
    : Stream.fromIterable(source as Iterable<A>)

/** Options for {@linkcode pooledMap} and {@linkcode pooledMapSettled}. */
export interface PooledMapOptions {
  /** How many effects run at once. */
  readonly concurrency: Types.Concurrency
}

const concurrencyOf = (options: number | PooledMapOptions): Types.Concurrency =>
  typeof options === "number" ? options : options.concurrency

/**
 * Maps every element with an effect, running up to `concurrency` at once,
 * and emits the results in input order. Fails with the first error.
 * `Stream.mapEffect(source, f, { concurrency })`.
 */
export const pooledMap = <A, B, E = never, R = never, E2 = never, R2 = never>(
  source: Source<A, E, R>,
  f: (a: A) => Effect.Effect<B, E2, R2>,
  options: number | PooledMapOptions,
): Stream.Stream<B, E | E2 | AsyncIterableError, R | R2> =>
  Stream.mapEffect(toStream(source), (a) => f(a), { concurrency: concurrencyOf(options) })

/**
 * Like {@linkcode pooledMap}, but emits every outcome as a `Result` instead
 * of failing on the first error (std's `pooledMapSettled`).
 */
export const pooledMapSettled = <A, B, E = never, R = never, E2 = never, R2 = never>(
  source: Source<A, E, R>,
  f: (a: A) => Effect.Effect<B, E2, R2>,
  options: number | PooledMapOptions,
): Stream.Stream<Result.Result<B, E2>, E | AsyncIterableError, R | R2> =>
  Stream.mapEffect(toStream(source), (a) => Effect.result(f(a)), { concurrency: concurrencyOf(options) })

/**
 * Merges sources into one stream, emitting elements as they arrive (std's
 * `MuxAsyncIterator`). `Stream.mergeAll(sources, { concurrency: "unbounded" })`.
 */
export const mux = <A, E = never, R = never>(
  ...sources: ReadonlyArray<Source<A, E, R>>
): Stream.Stream<A, E | AsyncIterableError, R> =>
  Stream.mergeAll(sources.map((source) => toStream(source)), { concurrency: "unbounded" })

/** Options for {@linkcode tee}. */
export interface TeeOptions {
  /**
   * How many chunks the source may run ahead of the slowest branch. Defaults
   * to 16; `"unbounded"` never makes the source wait.
   */
  readonly capacity?: number | "unbounded" | undefined
}

/**
 * Splits a source into `n` (default 2) streams that each emit every element.
 * The source starts once every branch is running and stops with the scope.
 * `Stream.broadcastN`.
 */
export const tee = <A, E = never, R = never, const N extends number = 2>(
  source: Source<A, E, R>,
  n: N = 2 as N,
  options?: TeeOptions,
): Effect.Effect<Types.TupleOf<N, Stream.Stream<A, E | AsyncIterableError>>, never, Scope.Scope | R> => {
  // broadcastN accepts both capacities; one options object keeps the overloads apart.
  const broadcastOptions = { n, capacity: options?.capacity ?? 16 } as { readonly n: N; readonly capacity: number }
  return Stream.broadcastN(toStream(source), broadcastOptions)
}

// ---------------------------------------------------------------------------
// poll, waitFor, lazy, allKeyed, semaphore
// ---------------------------------------------------------------------------

/** Options for {@linkcode poll}. */
export interface PollOptions {
  /** How long to wait between runs. Defaults to 1 second. */
  readonly interval?: Duration.Input | undefined
}

/**
 * Runs `self` every `interval` until `isDone` accepts its result, and
 * returns that result. `Effect.repeat(self, { schedule: Schedule.spaced(interval), until: isDone })`,
 * returning the value.
 */
export const poll: {
  <A>(isDone: (a: A) => boolean, options?: PollOptions): <E, R>(self: Effect.Effect<A, E, R>) => Effect.Effect<A, E, R>
  <A, E, R>(self: Effect.Effect<A, E, R>, isDone: (a: A) => boolean, options?: PollOptions): Effect.Effect<A, E, R>
} = Function.dual(
  (args: IArguments) => Effect.isEffect(args[0]),
  <A, E, R>(self: Effect.Effect<A, E, R>, isDone: (a: A) => boolean, options?: PollOptions): Effect.Effect<A, E, R> => {
    const interval = options?.interval ?? "1 second"
    const loop: Effect.Effect<A, E, R> = Effect.flatMap(
      self,
      (a) => isDone(a) ? Effect.succeed(a) : Effect.andThen(Effect.sleep(interval), Effect.suspend(() => loop)),
    )
    return loop
  },
)

/** Options for {@linkcode waitFor}. */
export interface WaitForOptions {
  /** How often to check. Defaults to 100 milliseconds. */
  readonly step?: Duration.Input | undefined
}

/**
 * Checks `predicate` every `step` until it holds, failing with a
 * {@linkcode DeadlineError} after `timeout`. The predicate can be a plain
 * function or an effect.
 */
export const waitFor = <E = never, R = never>(
  predicate: (() => boolean) | Effect.Effect<boolean, E, R>,
  timeout: Duration.Input,
  options?: WaitForOptions,
): Effect.Effect<void, E | DeadlineError, R> => {
  const check: Effect.Effect<boolean, E, R> = Effect.isEffect(predicate) ? predicate : Effect.sync(predicate)
  const step = options?.step ?? "100 millis"
  const loop: Effect.Effect<void, E, R> = Effect.andThen(
    Effect.sleep(step),
    Effect.flatMap(check, (done) => done ? Effect.void : Effect.suspend(() => loop)),
  )
  return deadline(loop, timeout)
}

/**
 * A value computed once, on first use, by an effect (std's `Lazy`).
 * Concurrent first uses share one computation. A failed computation is not
 * kept: the next {@linkcode Lazy.get} tries again.
 */
export class Lazy<A, E = never, R = never> {
  readonly #cache: Cache.Cache<void, A, E, R>

  /** Use {@linkcode lazy} to create one. */
  constructor(cache: Cache.Cache<void, A, E, R>) {
    this.#cache = cache
  }

  /** The value, computing it on first use. */
  get get(): Effect.Effect<A, E, R> {
    return Cache.get(this.#cache, undefined)
  }

  /** The value if it has been computed. */
  get peek(): Effect.Effect<Option.Option<A>> {
    return Cache.getSuccess(this.#cache, undefined)
  }

  /** Whether the value has been computed. */
  get initialized(): Effect.Effect<boolean> {
    return Effect.map(this.peek, Option.isSome)
  }

  /** Forgets the value, so the next {@linkcode Lazy.get} computes it again. */
  get reset(): Effect.Effect<void> {
    return Cache.invalidate(this.#cache, undefined)
  }
}

/** Creates a {@linkcode Lazy} value. Built on Effect's `Cache` with one entry. */
export const lazy = <A, E = never, R = never>(init: Effect.Effect<A, E, R>): Effect.Effect<Lazy<A, E, R>> =>
  Effect.map(
    Cache.makeWith((_: void) => init, {
      capacity: 1,
      requireServicesAt: "lookup",
      timeToLive: (exit: Exit.Exit<A, E>) => Exit.isSuccess(exit) ? Duration.infinity : Duration.zero,
    }),
    (cache) => new Lazy(cache),
  )

/**
 * Runs a record of effects concurrently and succeeds with a record of their
 * values; fails with the first error. `Effect.all(record, { concurrency: "unbounded" })`.
 */
export const allKeyed = <const T extends Record<string, Effect.Effect<any, any, any>>>(
  record: T,
): Effect.All.Return<T, { concurrency: "unbounded" }> =>
  Effect.all(record, { concurrency: "unbounded" })

/**
 * Runs a record of effects concurrently and succeeds with a record of their
 * `Result`s. `Effect.all(record, { concurrency: "unbounded", mode: "result" })`.
 */
export const allSettledKeyed = <const T extends Record<string, Effect.Effect<any, any, any>>>(
  record: T,
): Effect.All.Return<T, { concurrency: "unbounded"; mode: "result" }> =>
  Effect.all(record, { concurrency: "unbounded", mode: "result" })

/**
 * Creates a semaphore with `permits` permits. Exactly `Semaphore.make`. Run
 * an effect holding permits with `Semaphore.withPermits(semaphore, n)(effect)`
 * or `Semaphore.withPermit`; std's `acquire` / `release` are
 * `Semaphore.take` / `Semaphore.release`.
 */
export const semaphore = (permits: number): Effect.Effect<Semaphore.Semaphore> => Semaphore.make(permits)
