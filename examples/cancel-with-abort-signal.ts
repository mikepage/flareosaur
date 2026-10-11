/**
 * @title Cancel async work with an AbortSignal
 * @difficulty intermediate
 * @tags workers, async
 * @group Basics
 * @resource {https://developer.mozilla.org/en-US/docs/Web/API/AbortController} MDN: AbortController
 * @resource {https://developer.mozilla.org/en-US/docs/Web/API/AbortSignal/any_static} MDN: AbortSignal.any()
 * @resource {https://jsr.io/@std/async/doc/abortable/~/abortable} @std/async: abortable
 * @check GET / -> 200 "download aborted, cleanup ran: download" "race winner: mirror-b" "losers aborted: mirror-a" "aborted by signal: true"
 *
 * On the web, cancellation is an `AbortController`: its `signal` is passed
 * down to the work, and `abort()` tells the work to stop. `fetch`, std's
 * `delay` and streams all accept one. `AbortSignal.any` combines signals,
 * and std's `abortable` makes any promise or async iterable cancelable.
 */

import { abortable } from "@mikepage/flareosaur/async/abortable";
import { delay } from "@mikepage/flareosaur/async/delay";
import { script } from "./_lib/script.ts";

// A long download that stops when its signal aborts. The finally block is
// where cleanup goes, like closing a stream.
async function download(
  signal: AbortSignal,
  cleanups: string[],
): Promise<void> {
  try {
    await delay(10_000, { signal });
  } finally {
    cleanups.push("download");
  }
}

// A mirror that answers after `ms`, unless it is aborted first.
async function mirror(
  name: string,
  ms: number,
  signal: AbortSignal,
  aborted: string[],
) {
  signal.addEventListener("abort", () => aborted.push(name));
  await delay(ms, { signal });
  return name;
}

export default script(async (print) => {
  // Abort running work; its cleanup runs.
  const cleanups: string[] = [];
  const controller = new AbortController();
  const running = download(controller.signal, cleanups);
  await delay(20);
  controller.abort();
  await running.catch(() => {});
  print(`download aborted, cleanup ran: ${cleanups.join(", ")}`);

  // Race two mirrors, then abort the losers so they stop too. Promise.race
  // alone would leave them running.
  const race = new AbortController();
  const aborted: string[] = [];
  const winner = await Promise.race([
    mirror("mirror-a", 50, race.signal, aborted),
    mirror("mirror-b", 10, race.signal, aborted),
  ]);
  race.abort();
  print(`race winner: ${winner}`);
  print(
    `losers aborted: ${aborted.filter((name) => name !== winner).join(", ")}`,
  );

  // AbortSignal.any: stop when the caller aborts or after a timeout,
  // whichever comes first. abortable() wraps a promise that takes no signal.
  const caller = new AbortController();
  setTimeout(() => caller.abort(), 20);
  const signal = AbortSignal.any([caller.signal, AbortSignal.timeout(1000)]);
  const never = new Promise<string>(() => {});
  const result = await abortable(never, signal).catch(() => "aborted");
  print(`aborted by signal: ${result === "aborted"}`);
});
