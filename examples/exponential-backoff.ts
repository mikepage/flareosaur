/**
 * @title Retry with exponential backoff
 * @difficulty intermediate
 * @tags workers, async
 * @group Basics
 * @resource {https://jsr.io/@std/async/doc/retry/~/retry} @std/async: retry
 * @check GET / -> 200 "attempt 1 failed" "attempt 3 succeeded" "gave up after 4 attempts" "not retried: bad request"
 *
 * Exponential backoff retries a failing operation with growing delays, so a
 * struggling service gets room to recover. std's `retry` does this with
 * jitter, a cap on attempts and delays, and an `isRetriable` check to
 * decide which errors are worth another try.
 */

import { retry, RetryError } from "@mikepage/flareosaur/async/retry";
import { script } from "./_lib/script.ts";

// An error that says whether trying again could help.
class Unavailable extends Error {
  constructor(readonly attempt: number, readonly retryable: boolean) {
    super(`unavailable on attempt ${attempt}`);
  }
}

// A flaky call that succeeds on attempt `succeedOn`.
function flaky(print: (...v: unknown[]) => void, succeedOn: number) {
  let attempt = 0;
  return async () => {
    attempt++;
    if (attempt < succeedOn) {
      print(`attempt ${attempt} failed`);
      throw new Unavailable(attempt, true);
    }
    print(`attempt ${attempt} succeeded`);
    return attempt;
  };
}

// Delays of 10 ms, 20 ms, 40 ms, ... with full jitter, at most 4 attempts.
// In production, start higher (std's default minTimeout is 1 s) and keep
// the total within what the request can wait.
const backoff = {
  minTimeout: 10,
  multiplier: 2,
  maxTimeout: 200,
  maxAttempts: 4,
  isRetriable: (error: unknown) =>
    error instanceof Unavailable && error.retryable,
};

export default script(async (print) => {
  await retry(flaky(print, 3), backoff);

  // When every attempt fails, retry throws a RetryError. Its cause is the
  // last error.
  try {
    await retry(flaky(print, 10), backoff);
  } catch (error) {
    if (error instanceof RetryError && error.cause instanceof Unavailable) {
      print(`gave up after ${error.cause.attempt} attempts`);
    }
  }

  // An error isRetriable rejects is thrown at once, without retrying.
  const result = await retry(() => {
    throw new Error("bad request");
  }, backoff).catch((error: Error) => error.message);
  print(`not retried: ${result}`);
});
