/**
 * @title Sleep and delay execution
 * @difficulty beginner
 * @tags workers, async
 * @group Basics
 * @resource {https://jsr.io/@std/async/doc/delay/~/delay} @std/async: delay
 * @resource {https://developer.mozilla.org/en-US/docs/Web/API/AbortController} MDN: AbortController
 * @check GET / -> 200 "waiting..." "done" "slept and then said: woke up" "sleep canceled after 50ms"
 *
 * Programs often need to wait: between retries, while polling, or to pace
 * requests. std's `delay` is a promise that resolves after some
 * milliseconds. It never blocks the isolate, and an `AbortSignal` cancels it.
 */

import { delay } from "@mikepage/flareosaur/async/delay";
import { script } from "./_lib/script.ts";

export default script(async (print) => {
  // await delay(ms) pauses this request only. Other requests keep running.
  print("waiting...");
  await delay(100);
  print("done"); // prints 100 ms later

  // Delay a value: sleep, then go on with the result.
  const said = await delay(50).then(() => "woke up");
  print(`slept and then said: ${said}`);

  // A sleep can be canceled with an AbortController. The promise rejects
  // with the signal's reason and the timer is cleared.
  const controller = new AbortController();
  setTimeout(() => controller.abort(), 50);
  try {
    await delay(10_000, { signal: controller.signal });
  } catch (error) {
    if ((error as DOMException).name === "AbortError") {
      print("sleep canceled after 50ms");
    }
  }
});
