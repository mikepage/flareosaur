/**
 * @title Add a timeout to any async work
 * @difficulty beginner
 * @tags workers, async
 * @group Basics
 * @resource {https://developer.mozilla.org/en-US/docs/Web/API/AbortSignal/timeout_static} MDN: AbortSignal.timeout()
 * @resource {https://jsr.io/@std/async/doc/deadline/~/deadline} @std/async: deadline
 * @check GET / -> 200 "fast: 42" "slow: TimeoutError" "fallback: cached value" "signal: TimeoutError"
 *
 * A promise has no built-in time limit. When the work takes an
 * `AbortSignal`, like `fetch` does, pass it `AbortSignal.timeout(ms)` and the
 * work stops itself. For a promise that takes no signal, std's `deadline`
 * rejects with a `TimeoutError` when the time runs out.
 */

import { deadline } from "@mikepage/flareosaur/async/deadline";
import { delay } from "@mikepage/flareosaur/async/delay";
import { script } from "./_lib/script.ts";

// Some work that resolves to `value` after `ms` milliseconds. It stops
// early when its signal aborts.
async function work<T>(value: T, ms: number, signal: AbortSignal): Promise<T> {
  await delay(ms, { signal });
  return value;
}

export default script(async (print) => {
  // One controller for the whole request. Aborting it at the end stops any
  // work that is still running, so nothing outlives the response.
  const request = new AbortController();
  const { signal } = request;
  try {
    // Within the limit: the value comes through.
    print("fast:", await deadline(work(42, 10, signal), 100));

    // Over the limit: deadline rejects with a DOMException named
    // TimeoutError. It only stops waiting: the work itself keeps going.
    try {
      await deadline(work(0, 1000, signal), 50);
    } catch (error) {
      print("slow:", (error as DOMException).name);
    }

    // Fall back to another value instead of failing.
    const fallback = await deadline(work("fresh value", 1000, signal), 50)
      .catch((error) => {
        if (error instanceof DOMException && error.name === "TimeoutError") {
          return "cached value";
        }
        throw error;
      });
    print("fallback:", fallback);

    // Better: when the work accepts a signal, give it a timeout signal. The
    // timer inside is cleared, so the work really stops. The same goes for
    // fetch(url, { signal: AbortSignal.timeout(5000) }).
    try {
      await work(0, 1000, AbortSignal.timeout(50));
    } catch (error) {
      print("signal:", (error as DOMException).name);
    }
  } finally {
    request.abort();
  }
});
