/**
 * @title Memoize an expensive function
 * @difficulty intermediate
 * @tags workers, cache
 * @group Basics
 * @resource {https://jsr.io/@std/cache/doc/memoize/~/memoize} @std/cache: memoize
 * @resource {https://jsr.io/@std/cache/doc/lru-cache/~/LruCache} @std/cache: LruCache
 * @resource {https://jsr.io/@std/async/doc/lazy/~/Lazy} @std/async: Lazy
 * @check GET / -> 200 "computing 10" "computed 1 time(s) for 3 lookups" "lazy config loaded once" "fib(50): 12586269025"
 *
 * Memoization caches the result of a call so repeated calls are free. std's
 * `memoize` caches by argument, and for async functions it caches the
 * promise, so concurrent calls share one computation. An `LruCache` caps
 * its size. `Lazy` runs an initializer once, on first use.
 */

import { Lazy } from "@mikepage/flareosaur/async/lazy";
import { delay } from "@mikepage/flareosaur/async/delay";
import { LruCache } from "@mikepage/flareosaur/cache/lru-cache";
import {
  type MemoizationCacheResult,
  memoize,
} from "@mikepage/flareosaur/cache/memoize";
import { script } from "./_lib/script.ts";

// A pure, synchronous function may be memoized per isolate: its results
// never change, so sharing them between requests is safe. The LruCache
// keeps at most 1000 of them.
const fib: (n: number) => number = memoize<
  (n: number) => number,
  number,
  LruCache<number, MemoizationCacheResult<number>>
>(
  (n: number): number => n < 2 ? n : fib(n - 1) + fib(n - 2),
  {
    cache: new LruCache(1000),
    getKey: (n) => n,
  },
);

export default script(async (print) => {
  // Async lookups are memoized per request. A promise cached in global
  // scope would be shared with other requests while still in flight, and
  // Workers do not allow one request to wait on another's I/O.
  let computations = 0;
  const square = memoize(async (n: number) => {
    computations++;
    print(`computing ${n}`);
    await delay(10);
    return n * n;
  });

  // Three concurrent calls: the first starts the work, the others get the
  // same promise.
  await Promise.all([square(10), square(10), square(10)]);
  print(`computed ${computations} time(s) for 3 lookups`);

  // Lazy runs its initializer on the first get, then returns the same value.
  const config = new Lazy(() => {
    print("lazy config loaded once");
    return { debug: true };
  });
  await config.get();
  await config.get();

  print(`fib(50): ${fib(50)}`);
});
