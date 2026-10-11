/**
 * @title Check if two values are deeply equal
 * @difficulty beginner
 * @tags workers, assert
 * @group Basics
 * @resource {https://jsr.io/@std/assert/doc/equal/~/equal} @std/assert: equal
 * @resource {https://developer.mozilla.org/en-US/docs/Web/JavaScript/Equality_comparisons_and_sameness} MDN: equality comparisons
 * @check GET / -> 200 "=== false" "equal: true" "Maps: true" "Sets: true" "Dates: true" "different values: false"
 *
 * Two objects with the same contents are not equal with `===`, which
 * compares references. std's `equal` compares structurally: plain objects,
 * arrays, Maps, Sets, Dates, typed arrays and URLs by value, and it handles
 * cycles.
 */

import { equal } from "@mikepage/flareosaur/assert/equal";
import { script } from "./_lib/script.ts";

export default script((print) => {
  const a = { name: "Ada", languages: ["en", "fr"] };
  const b = { name: "Ada", languages: ["en", "fr"] };

  // === compares references: these are two different objects.
  print("===", a === b);

  // equal walks both values and compares what is inside.
  print("equal:", equal(a, b));

  // Maps and Sets compare by their entries, in any order.
  print(
    "Maps:",
    equal(new Map([["x", 1], ["y", 2]]), new Map([["y", 2], ["x", 1]])),
  );
  print("Sets:", equal(new Set([1, 2, 3]), new Set([3, 2, 1])));

  // Dates compare by the time they hold.
  print("Dates:", equal(new Date("2026-01-01"), new Date(1767225600000)));

  // Bytes compare by content, handy for comparing digests.
  print("bytes:", equal(new Uint8Array([1, 2]), new Uint8Array([1, 2])));

  // One differing field is enough to make them unequal.
  print("different values:", equal(a, { ...a, name: "Grace" }));
});
