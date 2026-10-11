/**
 * @title Generate seeded random numbers
 * @difficulty beginner
 * @tags workers, random
 * @group Basics
 * @resource {https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Global_Objects/Math/random} MDN: Math.random()
 * @resource {https://developer.mozilla.org/en-US/docs/Web/API/Crypto/getRandomValues} MDN: crypto.getRandomValues()
 * @check GET / -> 200 "same sequence: true" "dice:" "shuffled:"
 *
 * `Math.random` cannot be seeded, so code that depends on it is hard to
 * test. A seeded generator produces the same numbers for the same seed
 * every time. A few lines are enough: mulberry32 is a tiny, fast PRNG.
 * It is not secure; use `crypto.getRandomValues` for tokens and keys.
 */

import { script } from "./_lib/script.ts";

// Turns a string into a 32-bit seed (FNV-1a hash).
function hash(seed: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < seed.length; i++) {
    h = Math.imul(h ^ seed.charCodeAt(i), 0x01000193);
  }
  return h >>> 0;
}

// mulberry32: returns a function that gives a number in [0, 1), like
// Math.random, but determined by the seed.
function seeded(seed: string | number): () => number {
  let state = typeof seed === "string" ? hash(seed) : seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// An integer in [min, max).
function intBetween(random: () => number, min: number, max: number): number {
  return min + Math.floor(random() * (max - min));
}

// Fisher-Yates shuffle into a new array.
function shuffle<T>(random: () => number, items: readonly T[]): T[] {
  const out = [...items];
  for (let i = out.length - 1; i > 0; i--) {
    const j = intBetween(random, 0, i + 1);
    [out[i], out[j]] = [out[j]!, out[i]!];
  }
  return out;
}

export default script((print) => {
  // The generator is made per request. Randomness and mutable state in
  // global scope are not allowed on Workers.
  const roll = (random: () => number) =>
    [1, 2, 3].map(() => intBetween(random, 1, 7));

  const first = roll(seeded("dice"));
  const second = roll(seeded("dice"));
  print("same sequence:", first.join() === second.join());
  print("dice:", first.join(", "));

  // Shuffle deterministically too.
  print("shuffled:", shuffle(seeded(42), ["A", "K", "Q", "J"]).join(" "));

  // For values nobody should guess, use the secure generator. It has no seed.
  const bytes = crypto.getRandomValues(new Uint8Array(4));
  print("secure bytes:", bytes.length);
});
