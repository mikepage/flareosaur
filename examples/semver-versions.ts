/**
 * @title Parse and compare semver versions
 * @difficulty beginner
 * @tags workers, semver
 * @group Standard library
 * @resource {https://jsr.io/@std/semver} @std/semver
 * @resource {https://semver.org} Semantic Versioning
 * @check GET / -> 200 "sorted: 1.2.0, 1.10.0, 2.0.0-beta.1, 2.0.0" "1.10.0 satisfies ^1.2.0: true" "best match for ~1.2: 1.2.0" "next minor: 1.11.0" "difference: minor" "invalid: TypeError" "tryParse: undefined"
 *
 * Version strings cannot be compared as text: "1.10.0" sorts before
 * "1.2.0". std's semver parses them into objects, and `compare` sorts
 * them the way the spec says, prereleases before their release. Ranges,
 * increments and comparisons follow npm's rules.
 */

import {
  compare,
  difference,
  format,
  increment,
  maxSatisfying,
  parse,
  parseRange,
  satisfies,
  tryParse,
} from "@mikepage/flareosaur/semver";
import { script } from "./_lib/script.ts";

export default script((print) => {
  const versions = ["2.0.0", "1.10.0", "2.0.0-beta.1", "1.2.0"].map(parse);

  // compare returns -1, 0 or 1, so it works with Array.prototype.toSorted.
  const sorted = versions.toSorted(compare);
  print(`sorted: ${sorted.map(format).join(", ")}`);

  const v1_10 = parse("1.10.0");
  print(`1.10.0 satisfies ^1.2.0: ${satisfies(v1_10, parseRange("^1.2.0"))}`);

  // maxSatisfying picks the highest version in a range, if any.
  const best = maxSatisfying(versions, parseRange("~1.2"));
  print(`best match for ~1.2: ${best ? format(best) : "none"}`);

  print(`next minor: ${format(increment(v1_10, "minor"))}`);
  print(`difference: ${difference(parse("1.2.0"), v1_10)}`);

  // parse throws on bad input; tryParse returns undefined instead.
  try {
    parse("one.two");
  } catch (error) {
    print(`invalid: ${error instanceof Error ? error.name : error}`);
  }
  print(`tryParse: ${tryParse("one.two")}`);
});
