/**
 * @title Set timeouts and intervals
 * @difficulty beginner
 * @tags workers, async
 * @group Basics
 * @resource {https://developer.mozilla.org/en-US/docs/Web/API/Window/setInterval} MDN: setInterval()
 * @resource {https://developers.cloudflare.com/workers/runtime-apis/web-standards/#timers} Cloudflare: timers
 * @resource {https://jsr.io/@std/async/doc/poll/~/poll} @std/async: poll
 * @check GET / -> 200 "tick 1" "tick 3" "polled 3 times" "timeout fired"
 *
 * Workers have `setTimeout` and `setInterval`, but a timer must not outlive
 * the request that set it. Wrap timers in a promise and await it before
 * responding, or clear them. For work that should run on a schedule across
 * requests, use a Cron Trigger or a Durable Object alarm instead.
 */

import { delay } from "@mikepage/flareosaur/async/delay";
import { poll } from "@mikepage/flareosaur/async/poll";
import { script } from "./_lib/script.ts";

export default script(async (print) => {
  // setInterval: run every 10 ms, and clear the interval after three ticks.
  // The promise resolves once the interval is cleared.
  await new Promise<void>((resolve) => {
    let ticks = 0;
    const id = setInterval(() => {
      ticks++;
      print(`tick ${ticks}`);
      if (ticks === 3) {
        clearInterval(id);
        resolve();
      }
    }, 10);
  });

  // Polling until a condition holds: std's poll calls the function, waits
  // `interval` ms, and repeats until isDone returns true.
  let attempts = 0;
  await poll(() => ++attempts, (n) => n >= 3, { interval: 5 });
  print(`polled ${attempts} times`);

  // setTimeout: run something once after a delay. std's delay is the
  // promise version, and it takes an AbortSignal to cancel it.
  await delay(20);
  print("timeout fired");
});
