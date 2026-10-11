/**
 * @title Run tasks with a concurrency limit
 * @difficulty intermediate
 * @tags workers, async
 * @group Basics
 * @resource {https://jsr.io/@std/async/doc/pool/~/pooledMap} @std/async: pooledMap
 * @resource {https://jsr.io/@std/async/doc/unstable-semaphore/~/Semaphore} @std/async: Semaphore
 * @resource {https://developers.cloudflare.com/workers/platform/limits/#simultaneous-open-connections} Cloudflare: simultaneous open connections
 * @check GET / -> 200 "processed 10 items" "at most 3 at once" "semaphore: 2 at once"
 *
 * Firing hundreds of requests at once can overload a service or hit a rate
 * limit, and a Worker may only have six connections open at a time. std's
 * `pooledMap` maps over items with at most N in flight. A `Semaphore`
 * limits concurrency across unrelated parts of the code.
 */

import { delay } from "@mikepage/flareosaur/async/delay";
import { pooledMap } from "@mikepage/flareosaur/async/pool";
import { Semaphore } from "@mikepage/flareosaur/async/unstable-semaphore";
import { script } from "./_lib/script.ts";

export default script(async (print) => {
  // Counters to see how many tasks run at the same time. They live inside
  // the request, so requests do not share them.
  let running = 0;
  let peak = 0;
  const task = async (n: number) => {
    peak = Math.max(peak, ++running);
    await delay(10);
    running--;
    return n * 2;
  };

  // Ten tasks, three at a time. pooledMap returns an async iterator;
  // Array.fromAsync collects it. Results keep the input order.
  const items = Array.from({ length: 10 }, (_, i) => i);
  const results = await Array.fromAsync(pooledMap(3, items, task));
  print(`processed ${results.length} items, at most ${peak} at once`);

  // A semaphore with 2 permits, shared by every caller of `limited`. The
  // `using` declaration releases the permit when the function returns.
  const semaphore = new Semaphore(2);
  const limited = async (n: number) => {
    using _permit = await semaphore.acquire();
    return await task(n);
  };
  peak = 0;
  await Promise.all([limited(1), limited(2), limited(3), limited(4)]);
  print(`semaphore: ${peak} at once`);
});
